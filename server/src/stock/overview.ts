import { pool } from '../db/pool.js';
import { calculateAvailability } from '../engine/availability.js';
import { getSettings } from '../lib/settings.js';
import { loadEngineInput, loadSyncHealth } from './repository.js';
import { getAvailability } from './stockService.js';

/**
 * Visão do estoque inteiro (todos os produtos), para a tela "Estoque".
 *
 * Produtos "com movimento" (pedidos em aberto, reservas, bloqueios, saldo zero/negativo, kits) passam
 * pelo motor completo. Os demais não têm nenhum compromisso, então o disponível é o próprio saldo e
 * só a atualidade do saldo/sincronização decide se é "confirmado" — o mesmo resultado que o motor daria,
 * sem recalcular milhares de produtos parados. O resultado fica em cache por 60 s.
 */

export interface StockRow {
  id: number;
  sku: string | null;
  name: string;
  unit: string | null;
  physical: number | null;
  virtual: number | null;
  committed: number;
  available: number | null;
  availableForSale: number;
  incoming: number;
  status: 'CONFIRMED' | 'UNCONFIRMED';
  issues: string[];
  /** kit calculado pelos componentes: fica fora dos totais (as unidades já estão nos componentes) */
  virtualKit: boolean;
  fetchedAt: string | null;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; rows: StockRow[] }>();

export function invalidateStockOverview() {
  cache.clear();
}

export async function stockOverview(depositId: number | null): Promise<StockRow[]> {
  const key = String(depositId ?? 'all');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;

  const settings = await getSettings();
  const now = new Date();
  const health = await loadSyncHealth(settings, now);

  // saldos por produto (somente depósitos que compõem a disponibilidade)
  const { rows: base } = await pool.query(
    `SELECT p.id, p.sku, p.name, p.unit, p.format,
            SUM(b.physical) FILTER (WHERE d.id IS NOT NULL) AS physical,
            SUM(b.virtual) FILTER (WHERE d.id IS NOT NULL) AS virtual,
            MIN(b.fetched_at) FILTER (WHERE d.id IS NOT NULL) AS fetched_at,
            COALESCE((SELECT SUM(i.quantity) FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.purchase_order_id
                      WHERE i.product_id = p.id AND po.situation_value IN (0, 3)), 0) AS incoming
     FROM products p
     LEFT JOIN stock_balances b ON b.product_id = p.id AND ($1::bigint IS NULL OR b.deposit_id = $1)
     LEFT JOIN deposits d ON d.id = b.deposit_id AND d.active AND NOT d.ignore_balance
     WHERE p.active AND p.format <> 'V' AND p.kind = 'P'
     GROUP BY p.id
     HAVING COUNT(d.id) > 0 OR p.format = 'E'`,
    [depositId],
  );

  // produtos que precisam do motor completo
  const { rows: busyRows } = await pool.query<{ id: number }>(
    `SELECT DISTINCT p.id FROM products p WHERE p.active AND p.kind = 'P' AND p.format <> 'V' AND (
       p.format = 'E'
       OR EXISTS (SELECT 1 FROM stock_balances b WHERE b.product_id = p.id AND b.physical <= 0)
       OR EXISTS (SELECT 1 FROM reservations r WHERE r.product_id = p.id AND r.status IN ('ACTIVE', 'EXPIRED'))
       OR EXISTS (SELECT 1 FROM stock_blocks k WHERE k.product_id = p.id AND k.active)
       OR EXISTS (SELECT 1 FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id
                  LEFT JOIN situations s ON s.id = o.situation_id
                  LEFT JOIN situation_rules r1 ON r1.situation_id = o.situation_id
                  LEFT JOIN situation_rules r2 ON r2.situation_id = s.inherited_id
                  WHERE i.product_id = p.id AND NOT o.deleted
                    AND COALESCE(r1.category, r2.category, 'UNMAPPED') IN ('COMMITTED', 'PRE_ORDER_RESERVED', 'UNMAPPED', 'FULFILLED')))`,
  );
  const busy = new Set(busyRows.map((r) => r.id));

  const rows: StockRow[] = [];
  for (const b of base) {
    if (busy.has(b.id)) {
      // kits passam pelo serviço completo (composição); os demais direto pelo motor
      let r;
      if (b.format === 'E') {
        r = await getAvailability(b.id);
      } else {
        const input = await loadEngineInput(b.id, settings, now);
        r = input ? calculateAvailability(input) : null;
      }
      if (!r) continue;
      const dep = depositId ? r.byDeposit.find((d) => d.depositId === depositId) : null;
      const deducted = dep
        ? Object.values(dep.deductions).reduce((t, v) => t + v, 0)
        : r.totalDeducted;
      rows.push({
        id: b.id,
        sku: b.sku,
        name: b.name,
        unit: b.unit,
        physical: dep ? dep.physical : r.physicalTotal,
        virtual: dep ? dep.virtual : r.virtualTotal,
        committed: Math.round(deducted * 10000) / 10000,
        available: dep ? dep.available : r.available,
        availableForSale: dep ? dep.availableForSale : r.availableForSale,
        incoming: Number(b.incoming),
        status: r.status,
        // primeiro o que impede a confirmação; depois os demais avisos
        issues: [...new Set([...r.issues.filter((i) => i.blocksConfirmation), ...r.issues.filter((i) => !i.blocksConfirmation && i.severity !== 'info')].map((i) => i.code))],
        fetchedAt: dep?.fetchedAt ?? r.dataAsOf,
        virtualKit: Boolean((r as { kit?: unknown }).kit),
      });
      continue;
    }
    const stale = !b.fetched_at || now.getTime() - b.fetched_at.getTime() > settings.engine.maxBalanceAgeMinutes * 60000;
    const issues = [...(stale ? ['STALE_BALANCE'] : []), ...(health.lastSyncFailed ? ['SYNC_FAILED'] : [])];
    rows.push({
      id: b.id,
      sku: b.sku,
      name: b.name,
      unit: b.unit,
      physical: b.physical,
      virtual: b.virtual,
      committed: 0,
      available: b.physical,
      availableForSale: Math.max(0, b.physical ?? 0),
      incoming: Number(b.incoming),
      status: issues.length ? 'UNCONFIRMED' : 'CONFIRMED',
      issues,
      fetchedAt: b.fetched_at ? b.fetched_at.toISOString() : null,
      virtualKit: false,
    });
  }
  cache.set(key, { at: Date.now(), rows });
  return rows;
}
