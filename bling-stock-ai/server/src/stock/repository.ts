import type { Db } from '../db/pool.js';
import { pool } from '../db/pool.js';
import type {
  CommitmentCategory,
  DepositBalance,
  EngineInput,
  IncomingEntry,
  LocalReservation,
  OperationalBlock,
  OrderCommitment,
  StockEffect,
  SyncHealth,
  VirtualEffect,
} from '../engine/types.js';
import type { AppSettings } from '../lib/settings.js';

/** Janela para exibir pedidos já encerrados (cancelados/atendidos) na explicação. */
const CLOSED_ORDERS_WINDOW_DAYS = 30;

export interface ProductRow {
  id: number;
  sku: string | null;
  name: string;
  unit: string | null;
  format: string;
  active: boolean;
  parent_id: number | null;
  source: string;
}

export async function getProduct(id: number, db: Db = pool): Promise<ProductRow | null> {
  const { rows } = await db.query<ProductRow>('SELECT id, sku, name, unit, format, active, parent_id, source FROM products WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function getKitComponents(id: number, db: Db = pool) {
  const { rows } = await db.query<{ component_id: number; quantity: number }>(
    'SELECT component_id, quantity FROM product_components WHERE product_id = $1',
    [id],
  );
  return rows;
}

export async function loadBalances(productId: number, db: Db = pool): Promise<DepositBalance[]> {
  const { rows } = await db.query(
    `SELECT d.id, d.name, d.is_default, d.ignore_balance, b.physical, b.virtual, b.fetched_at
     FROM stock_balances b JOIN deposits d ON d.id = b.deposit_id
     WHERE b.product_id = $1 AND d.active ORDER BY d.is_default DESC, d.name`,
    [productId],
  );
  return rows.map((r) => ({
    depositId: r.id,
    depositName: r.name,
    physical: r.physical,
    virtual: r.virtual,
    fetchedAt: r.fetched_at,
    ignoreBalance: r.ignore_balance,
    isDefault: r.is_default,
  }));
}

/**
 * Regra efetiva da situação: regra própria ou, para situações personalizadas,
 * a regra da situação padrão da qual ela herda (idHerdado).
 */
const RULE_JOIN = `
  LEFT JOIN situations s ON s.id = o.situation_id
  LEFT JOIN situation_rules r1 ON r1.situation_id = o.situation_id
  LEFT JOIN situation_rules r2 ON r2.situation_id = s.inherited_id`;

export async function loadCommitments(productId: number, db: Db = pool): Promise<OrderCommitment[]> {
  const { rows } = await db.query(
    `SELECT i.id AS item_id, i.quantity * k.factor AS quantity, k.factor, k.kit_sku, o.id AS order_id, o.number, o.customer_id, o.customer_name, o.seller_id,
            o.situation_id, s.name AS situation_name, o.expected_date, o.order_date,
            COALESCE(r1.category, r2.category) AS category,
            COALESCE(ov.stock_effect, r1.stock_effect, r2.stock_effect) AS stock_effect,
            COALESCE(r1.virtual_effect, r2.virtual_effect) AS virtual_effect,
            ov.deposit_id,
            COALESCE(f.delivered, 0) AS delivered, COALESCE(f.released, 0) AS released, COALESCE(f.all_posted, false) AS all_posted,
            EXISTS (
              SELECT 1 FROM sales_order_situation_history h
              LEFT JOIN situations hs ON hs.id = h.situation_id
              JOIN situation_rules hr ON hr.situation_id = h.situation_id OR hr.situation_id = hs.inherited_id
              WHERE h.order_id = o.id AND hr.stock_effect = 'POSTED'
            ) OR ov.stock_effect = 'POSTED' AS previously_posted
     FROM sales_order_items i
     -- itens do próprio produto (fator 1) e itens de kits que o contêm (fator = quantidade por kit)
     JOIN (
       SELECT $1::bigint AS item_product_id, 1::numeric AS factor, NULL::text AS kit_sku
       UNION ALL
       SELECT pc.product_id, pc.quantity, kp.sku FROM product_components pc JOIN products kp ON kp.id = pc.product_id
       WHERE pc.component_id = $1
     ) k ON k.item_product_id = i.product_id
     JOIN sales_orders o ON o.id = i.order_id AND NOT o.deleted
     ${RULE_JOIN}
     LEFT JOIN order_overrides ov ON ov.order_id = o.id
     LEFT JOIN (
       SELECT order_item_id, SUM(quantity_delivered) AS delivered, SUM(quantity_released) AS released,
              BOOL_AND(delivered_stock_posted OR quantity_delivered = 0) AS all_posted
       FROM item_fulfillments GROUP BY order_item_id
     ) f ON f.order_item_id = i.id
     WHERE (

         COALESCE(r1.category, r2.category) IS NULL
         OR COALESCE(r1.category, r2.category) IN ('COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY')
         OR COALESCE(o.order_date, o.synced_at::date) >= current_date - ${CLOSED_ORDERS_WINDOW_DAYS}
         OR (COALESCE(r1.category, r2.category) = 'FULFILLED' AND COALESCE(ov.stock_effect, r1.stock_effect, r2.stock_effect) <> 'POSTED')
       )
     ORDER BY o.order_date NULLS LAST, o.id, i.id`,
    [productId],
  );
  return rows.map((r) => ({
    orderId: r.order_id,
    orderNumber: r.number,
    itemId: r.item_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    sellerId: r.seller_id,
    situationId: r.situation_id,
    situationName: (r.situation_name ?? (r.situation_id ? `Situação ${r.situation_id}` : '')) + (r.kit_sku ? ` · via kit ${r.kit_sku}` : '') || null,
    category: (r.category ?? 'UNMAPPED') as CommitmentCategory,
    stockEffect: (r.stock_effect ?? 'UNKNOWN') as StockEffect,
    virtualEffect: (r.virtual_effect ?? 'UNKNOWN') as VirtualEffect,
    quantity: r.quantity,
    quantityDelivered: r.delivered * r.factor,
    quantityReleased: r.released * r.factor,
    deliveredStockPosted: r.all_posted,
    depositId: r.deposit_id,
    expectedDate: r.expected_date,
    orderDate: r.order_date,
    previouslyPosted: r.previously_posted,
  }));
}

export async function loadReservations(productId: number, db: Db = pool): Promise<LocalReservation[]> {
  const { rows } = await db.query(
    `SELECT r.id, r.quantity, r.deposit_id, r.status, r.expires_at, r.customer_id, r.customer_name, r.bling_order_id,
            r.reason, r.seller_user_id, u.name AS seller_name
     FROM reservations r JOIN users u ON u.id = r.seller_user_id
     WHERE r.product_id = $1 AND r.status IN ('PENDING', 'ACTIVE', 'EXPIRED')
     ORDER BY r.created_at`,
    [productId],
  );
  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    depositId: r.deposit_id,
    status: r.status,
    expiresAt: r.expires_at,
    customerId: r.customer_id,
    customerName: r.customer_name,
    sellerName: r.seller_name,
    sellerUserId: r.seller_user_id,
    blingOrderId: r.bling_order_id,
    reason: r.reason,
  }));
}

export async function loadBlocks(productId: number, db: Db = pool): Promise<OperationalBlock[]> {
  const { rows } = await db.query(
    'SELECT id, quantity, deposit_id, reason_type, notes FROM stock_blocks WHERE product_id = $1 AND active ORDER BY created_at',
    [productId],
  );
  return rows.map((r) => ({ id: r.id, quantity: r.quantity, depositId: r.deposit_id, reasonType: r.reason_type, notes: r.notes }));
}

export async function loadIncoming(productId: number, db: Db = pool): Promise<IncomingEntry[]> {
  const { rows } = await db.query(
    `SELECT po.id, po.number, po.expected_date, po.supplier_name, SUM(i.quantity) AS quantity
     FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.purchase_order_id
     WHERE i.product_id = $1 AND po.situation_value IN (0, 3)
     GROUP BY po.id ORDER BY po.expected_date NULLS LAST`,
    [productId],
  );
  return rows.map((r) => ({
    purchaseOrderId: r.id,
    purchaseOrderNumber: r.number,
    quantity: r.quantity,
    expectedDate: r.expected_date,
    supplierName: r.supplier_name,
  }));
}

export async function loadSyncHealth(settings: AppSettings, now: Date, db: Db = pool): Promise<SyncHealth> {
  const { rows } = await db.query<{ resource: string; last_success_at: Date | null; last_error_at: Date | null; last_error: string | null }>(
    "SELECT resource, last_success_at, last_error_at, last_error FROM sync_state WHERE resource IN ('sales_orders', 'balances')",
  );
  const byRes = new Map(rows.map((r) => [r.resource, r]));
  const problems: string[] = [];
  let lastSuccess: Date | null = null;
  for (const res of ['sales_orders', 'balances']) {
    const r = byRes.get(res);
    const label = res === 'sales_orders' ? 'pedidos' : 'saldos';
    if (!r?.last_success_at) {
      problems.push(`${label} nunca sincronizados`);
      continue;
    }
    if (!lastSuccess || r.last_success_at < lastSuccess) lastSuccess = r.last_success_at;
    if (r.last_error_at && r.last_error_at > r.last_success_at) problems.push(`${label}: ${r.last_error}`);
    if (res === 'sales_orders') {
      const age = (now.getTime() - r.last_success_at.getTime()) / 60000;
      if (age > settings.engine.ordersMaxAgeMinutes) problems.push(`pedidos sincronizados há ${Math.round(age)} min`);
    }
  }
  return { lastSyncFailed: problems.length > 0, lastSuccessAt: lastSuccess, lastError: problems.join('; ') || null };
}

export async function loadEngineInput(productId: number, settings: AppSettings, now: Date, db: Db = pool): Promise<EngineInput | null> {
  const product = await getProduct(productId, db);
  if (!product) return null;
  const [balances, commitments, reservations, blocks, incoming, sync] = await Promise.all([
    loadBalances(productId, db),
    loadCommitments(productId, db),
    loadReservations(productId, db),
    loadBlocks(productId, db),
    loadIncoming(productId, db),
    loadSyncHealth(settings, now, db),
  ]);
  return {
    product: { id: product.id, sku: product.sku, name: product.name, unit: product.unit },
    balances,
    commitments,
    reservations,
    blocks,
    incoming,
    settings: {
      baseMode: settings.engine.baseMode,
      maxBalanceAgeMinutes: settings.engine.maxBalanceAgeMinutes,
      expiredReservationPolicy: settings.engine.expiredReservationPolicy,
    },
    sync,
    now,
  };
}
