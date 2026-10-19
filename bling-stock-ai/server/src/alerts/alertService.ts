import type { Db } from '../db/pool.js';
import { pool } from '../db/pool.js';
import { calculateAvailability } from '../engine/availability.js';
import { getSettings } from '../lib/settings.js';
import { loadEngineInput } from '../stock/repository.js';
import { recordAttempt } from '../sync/syncService.js';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertInput {
  type: string;
  severity: AlertSeverity;
  dedupeKey: string;
  message: string;
  productId?: number | null;
  orderId?: number | null;
  reservationId?: string | null;
  userId?: string | null;
  details?: unknown;
}

/** Tipos de alerta mantidos pela varredura periódica (resolvidos automaticamente quando somem). */
const SCAN_TYPES = [
  'COMMITTED_WITHOUT_POSTING',
  'STALE_OPPORTUNITY',
  'RESERVATION_EXPIRING',
  'RESERVATION_EXPIRED',
  'NEGATIVE_BALANCE',
  'OVERCOMMITTED',
  'POSSIBLE_DUPLICATE',
  'CANCELLED_WITH_ACTIVE_RESERVATION',
  'CANCELLED_AFTER_POSTING',
  'UNMAPPED_SITUATION',
  'INCOMING_PENDING',
  'SYNC_FAILED',
  'SYNC_STALE',
  'PARTIAL_DELIVERY_NOT_POSTED',
];

export async function upsertAlert(a: AlertInput, db: Db = pool): Promise<void> {
  await db.query(
    `INSERT INTO alerts (type, severity, dedupe_key, product_id, order_id, reservation_id, user_id, message, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (dedupe_key) DO UPDATE SET severity = EXCLUDED.severity, message = EXCLUDED.message,
       details = EXCLUDED.details, updated_at = now(),
       status = CASE WHEN alerts.status = 'resolved' THEN 'open' ELSE alerts.status END,
       resolved_at = CASE WHEN alerts.status = 'resolved' THEN NULL ELSE alerts.resolved_at END`,
    [a.type, a.severity, a.dedupeKey, a.productId ?? null, a.orderId ?? null, a.reservationId ?? null, a.userId ?? null, a.message, a.details ? JSON.stringify(a.details) : null],
  );
}

async function productIdsToScan(): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT DISTINCT product_id AS id FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id
       WHERE NOT o.deleted AND i.product_id IS NOT NULL AND COALESCE(o.order_date, o.synced_at::date) >= current_date - 120
     UNION SELECT product_id FROM reservations WHERE status IN ('ACTIVE', 'EXPIRED', 'PENDING')
     UNION SELECT product_id FROM stock_blocks WHERE active
     UNION SELECT product_id FROM stock_balances WHERE physical < 0`,
  );
  return rows.map((r) => r.id).filter((id) => id !== null);
}

/** Varredura completa: gera/atualiza alertas e resolve os que deixaram de existir. */
export async function scanAlerts(): Promise<number> {
  const out = await recordAttempt('alerts_scan', 'agendado', async () => {
    const settings = await getSettings();
    const found: AlertInput[] = [];
    const now = new Date();

    // ---- sincronização
    const { rows: syncRows } = await pool.query(
      "SELECT resource, last_success_at, last_error_at, last_error FROM sync_state WHERE resource IN ('sales_orders', 'balances', 'products', 'purchase_orders')",
    );
    for (const r of syncRows) {
      if (r.last_error_at && (!r.last_success_at || r.last_error_at > r.last_success_at)) {
        found.push({ type: 'SYNC_FAILED', severity: 'critical', dedupeKey: `sync_failed:${r.resource}`, message: `Falha na sincronização de ${r.resource}: ${r.last_error}` });
      } else if (r.last_success_at && now.getTime() - r.last_success_at.getTime() > Math.max(3 * settings.sync.incrementalMinutes, settings.engine.ordersMaxAgeMinutes) * 60000) {
        found.push({ type: 'SYNC_STALE', severity: 'warning', dedupeKey: `sync_stale:${r.resource}`, message: `Sincronização de ${r.resource} interrompida: último sucesso em ${r.last_success_at.toISOString()}.` });
      }
    }

    // ---- pedidos confirmados sem baixa / pré-pedidos parados
    const { rows: orders } = await pool.query(
      `SELECT o.id, o.number, o.customer_name, o.order_date, COALESCE(r1.category, r2.category) AS category,
              COALESCE(ov.stock_effect, r1.stock_effect, r2.stock_effect) AS stock_effect
       FROM sales_orders o
       LEFT JOIN situations s ON s.id = o.situation_id
       LEFT JOIN situation_rules r1 ON r1.situation_id = o.situation_id
       LEFT JOIN situation_rules r2 ON r2.situation_id = s.inherited_id
       LEFT JOIN order_overrides ov ON ov.order_id = o.id
       WHERE NOT o.deleted AND o.order_date IS NOT NULL`,
    );
    for (const o of orders) {
      const ageDays = (now.getTime() - new Date(`${o.order_date}T12:00:00Z`).getTime()) / 86400000;
      if (o.category === 'COMMITTED' && o.stock_effect === 'NOT_POSTED' && ageDays > settings.alerts.committedWithoutPostingDays) {
        found.push({
          type: 'COMMITTED_WITHOUT_POSTING', severity: 'warning', dedupeKey: `committed_no_posting:${o.id}`, orderId: o.id,
          message: `Pedido ${o.number ?? o.id} confirmado há ${Math.floor(ageDays)} dias sem baixa de estoque registrada.`,
        });
      }
      if ((o.category === 'OPPORTUNITY' || o.category === 'PRE_ORDER_RESERVED') && ageDays > settings.alerts.staleOpportunityDays) {
        found.push({
          type: 'STALE_OPPORTUNITY', severity: 'info', dedupeKey: `stale_opportunity:${o.id}`, orderId: o.id,
          message: `Pré-pedido ${o.number ?? o.id} (${o.customer_name ?? 'cliente'}) parado há ${Math.floor(ageDays)} dias.`,
        });
      }
    }

    // ---- reservas vencendo / vencidas
    const { rows: res } = await pool.query(
      `SELECT r.id, r.status, r.expires_at, r.quantity, r.customer_name, r.seller_user_id, p.sku, p.name, r.product_id
       FROM reservations r JOIN products p ON p.id = r.product_id
       WHERE r.status IN ('ACTIVE', 'EXPIRED')`,
    );
    for (const r of res) {
      const hours = (r.expires_at.getTime() - now.getTime()) / 3600000;
      if (r.status === 'EXPIRED' || hours <= 0) {
        found.push({
          type: 'RESERVATION_EXPIRED', severity: 'warning', dedupeKey: `reservation_expired:${r.id}`, reservationId: r.id, productId: r.product_id, userId: r.seller_user_id,
          message: `Reserva de ${r.quantity} × ${r.sku ?? r.name} para ${r.customer_name ?? 'cliente'} venceu — renove ou libere.`,
        });
      } else if (hours <= settings.reservations.expiringSoonHours) {
        found.push({
          type: 'RESERVATION_EXPIRING', severity: 'info', dedupeKey: `reservation_expiring:${r.id}`, reservationId: r.id, productId: r.product_id, userId: r.seller_user_id,
          message: `Reserva de ${r.quantity} × ${r.sku ?? r.name} para ${r.customer_name ?? 'cliente'} vence em ${Math.ceil(hours)} h.`,
        });
      }
    }

    // ---- entradas aguardando confirmação
    const { rows: incoming } = await pool.query(
      "SELECT id, number, expected_date, supplier_name FROM purchase_orders WHERE situation_value IN (0, 3) AND expected_date < current_date",
    );
    for (const po of incoming) {
      found.push({
        type: 'INCOMING_PENDING', severity: 'info', dedupeKey: `incoming_pending:${po.id}`,
        message: `Pedido de compra ${po.number ?? po.id} (${po.supplier_name ?? 'fornecedor'}) previsto para ${po.expected_date} ainda não recebido.`,
      });
    }
    const { rows: entryBlocks } = await pool.query(
      `SELECT b.id, b.quantity, b.product_id, p.sku, p.name FROM stock_blocks b JOIN products p ON p.id = b.product_id
       WHERE b.active AND b.reason_type IN ('ENTRADA_NAO_RECEBIDA', 'CONFERENCIA')`,
    );
    for (const b of entryBlocks) {
      found.push({
        type: 'INCOMING_PENDING', severity: 'info', dedupeKey: `entry_block:${b.id}`, productId: b.product_id,
        message: `${b.quantity} × ${b.sku ?? b.name} aguardando conferência/recebimento.`,
      });
    }

    // ---- por produto (motor de disponibilidade)
    for (const productId of await productIdsToScan()) {
      const input = await loadEngineInput(productId, settings, now);
      if (!input) continue;
      const r = calculateAvailability(input);
      const label = `${r.product.sku ?? ''} ${r.product.name}`.trim();
      for (const issue of r.issues) {
        if (!SCAN_TYPES.includes(issue.code)) continue;
        if (issue.code === 'UNMAPPED_SITUATION') continue; // tratado abaixo, uma vez por situação
        found.push({
          type: issue.code,
          severity: issue.severity,
          dedupeKey: `${issue.code}:${productId}:${issue.refId ?? ''}`,
          productId,
          message: `${label}: ${issue.message}`,
        });
      }
    }
    const { rows: unmapped } = await pool.query(
      `SELECT DISTINCT o.situation_id, s.name, COUNT(*) OVER (PARTITION BY o.situation_id) AS n
       FROM sales_orders o LEFT JOIN situations s ON s.id = o.situation_id
       LEFT JOIN situation_rules r1 ON r1.situation_id = o.situation_id
       LEFT JOIN situation_rules r2 ON r2.situation_id = s.inherited_id
       WHERE NOT o.deleted AND o.situation_id IS NOT NULL AND r1.situation_id IS NULL AND r2.situation_id IS NULL`,
    );
    for (const u of unmapped) {
      found.push({
        type: 'UNMAPPED_SITUATION', severity: 'warning', dedupeKey: `unmapped_situation:${u.situation_id}`,
        message: `A situação "${u.name ?? u.situation_id}" não tem regra configurada (${u.n} pedido(s)). Configure em Administração › Regras de situação.`,
      });
    }

    for (const a of found) await upsertAlert(a);
    const keys = found.map((a) => a.dedupeKey);
    await pool.query(
      `UPDATE alerts SET status = 'resolved', resolved_at = now(), updated_at = now()
       WHERE status <> 'resolved' AND type = ANY($1) AND NOT (dedupe_key = ANY($2))`,
      [SCAN_TYPES, keys],
    );
    return { items: found.length };
  });
  return out.items;
}
