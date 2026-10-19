import type pg from 'pg';
import type { Db } from '../db/pool.js';
import { pool, withTransaction } from '../db/pool.js';
import type {
  BlingClient,
  BlingProductSummary,
  BlingPurchaseOrderDetail,
  BlingSalesOrderDetail,
} from '../bling/types.js';
import { normalize } from '../lib/text.js';
import { getSettings } from '../lib/settings.js';

/**
 * Sincronização SOMENTE LEITURA com o Bling (Fase 1).
 * Cada recurso registra sucesso/erro em sync_state e um histórico em sync_runs.
 */

export type SyncResource = 'deposits' | 'situations' | 'products' | 'balances' | 'sales_orders' | 'purchase_orders';

const BALANCE_CHUNK = 50;
const MAX_PAGES = 1000; // trava de segurança contra paginação infinita

function sourceOf(client: BlingClient) {
  return client.kind === 'demo' ? 'demo' : 'bling';
}

export async function recordAttempt<T>(
  resource: SyncResource | string,
  triggeredBy: string,
  fn: () => Promise<{ items: number; result?: T }>,
): Promise<{ items: number; result?: T }> {
  const { rows } = await pool.query<{ id: number }>(
    'INSERT INTO sync_runs (kind, triggered_by) VALUES ($1, $2) RETURNING id',
    [resource, triggeredBy],
  );
  const runId = rows[0].id;
  await pool.query(
    `INSERT INTO sync_state (resource, last_attempt_at) VALUES ($1, now())
     ON CONFLICT (resource) DO UPDATE SET last_attempt_at = now()`,
    [resource],
  );
  try {
    const out = await fn();
    await pool.query("UPDATE sync_runs SET status = 'success', finished_at = now(), items = $2 WHERE id = $1", [runId, out.items]);
    await pool.query('UPDATE sync_state SET last_success_at = now(), last_error = NULL WHERE resource = $1', [resource]);
    return out;
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 500) ?? String(err);
    await pool.query("UPDATE sync_runs SET status = 'error', finished_at = now(), error = $2 WHERE id = $1", [runId, msg]);
    await pool.query('UPDATE sync_state SET last_error = $2, last_error_at = now() WHERE resource = $1', [resource, msg]);
    throw err;
  }
}

// ------------------------------------------------------------------ depósitos
export async function syncDeposits(client: BlingClient, triggeredBy = 'system') {
  return recordAttempt('deposits', triggeredBy, async () => {
    let count = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const items = await client.listDeposits(page);
      for (const d of items) {
        await pool.query(
          `INSERT INTO deposits (id, name, is_default, ignore_balance, active, source, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_default = EXCLUDED.is_default,
             ignore_balance = EXCLUDED.ignore_balance, active = EXCLUDED.active, source = EXCLUDED.source, synced_at = now()`,
          [d.id, d.descricao, Boolean(d.padrao), Boolean(d.desconsiderarSaldo), d.situacao === undefined ? true : d.situacao === 1, sourceOf(client)],
        );
        count++;
      }
      if (items.length < 100) break;
    }
    return { items: count };
  });
}

// ------------------------------------------------------------------ situações
/** Sincroniza as situações dos módulos de venda (o nome do módulo contém "venda"). */
export async function syncSituations(client: BlingClient, triggeredBy = 'system') {
  return recordAttempt('situations', triggeredBy, async () => {
    const modules = await client.listModules();
    const salesModules = modules.filter((m) => /venda/i.test(`${m.nome} ${m.descricao ?? ''}`));
    let count = 0;
    for (const m of salesModules) {
      const situations = await client.listModuleSituations(m.id);
      for (const s of situations) {
        await pool.query(
          `INSERT INTO situations (id, module_id, name, inherited_id, source, synced_at) VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO UPDATE SET module_id = EXCLUDED.module_id, name = EXCLUDED.name,
             inherited_id = EXCLUDED.inherited_id, source = EXCLUDED.source, synced_at = now()`,
          [s.id, m.id, s.nome, s.idHerdado ?? null, sourceOf(client)],
        );
        count++;
      }
    }
    return { items: count };
  });
}

// ------------------------------------------------------------------ produtos
async function upsertProduct(db: Db, p: BlingProductSummary & { unidade?: string | null; gtin?: string | null }, source: string) {
  const search = normalize(`${p.codigo ?? ''} ${p.nome} ${p.gtin ?? ''}`);
  await db.query(
    `INSERT INTO products (id, parent_id, sku, name, gtin, unit, format, active, search_text, source, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, sku = EXCLUDED.sku, name = EXCLUDED.name,
       gtin = COALESCE(EXCLUDED.gtin, products.gtin), unit = COALESCE(EXCLUDED.unit, products.unit),
       format = EXCLUDED.format, active = EXCLUDED.active, search_text = EXCLUDED.search_text,
       source = EXCLUDED.source, synced_at = now()`,
    [p.id, p.idProdutoPai || null, p.codigo ?? null, p.nome, p.gtin ?? null, p.unidade ?? null, p.formato ?? 'S', p.situacao !== 'I', search, source],
  );
}

export async function syncProducts(client: BlingClient, opts: { since?: string } = {}, triggeredBy = 'system') {
  return recordAttempt('products', triggeredBy, async () => {
    let count = 0;
    const kits: number[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      // critério 5 = todos (inclui inativos, para refletir inativações)
      const items = await client.listProducts({ pagina: page, limite: 100, criterio: 5, dataAlteracaoInicial: opts.since });
      for (const p of items) {
        await upsertProduct(pool, p, sourceOf(client));
        if (p.formato === 'E') kits.push(p.id);
        count++;
      }
      if (items.length < 100) break;
    }
    // Kits: a composição só vem no detalhe do produto.
    for (const id of kits) {
      const detail = await client.getProduct(id);
      if (!detail) continue;
      await upsertProduct(pool, detail, sourceOf(client));
      await withTransaction(async (tx) => {
        await tx.query('DELETE FROM product_components WHERE product_id = $1', [id]);
        for (const c of detail.estrutura?.componentes ?? []) {
          await tx.query(
            'INSERT INTO product_components (product_id, component_id, quantity) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [id, c.produto.id, c.quantidade],
          );
        }
      });
    }
    return { items: count };
  });
}

// ------------------------------------------------------------------ saldos
async function ensureDeposit(db: Db, depositId: number, source: string) {
  await db.query(
    `INSERT INTO deposits (id, name, source) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [depositId, `Depósito ${depositId}`, source],
  );
}

/** Atualiza saldos físicos/virtuais por depósito dos produtos informados. */
export async function refreshBalances(client: BlingClient, productIds: number[]): Promise<number> {
  let count = 0;
  const source = sourceOf(client);
  for (let i = 0; i < productIds.length; i += BALANCE_CHUNK) {
    const chunk = productIds.slice(i, i + BALANCE_CHUNK);
    const balances = await client.getBalances(chunk);
    const fetchedAt = new Date();
    await withTransaction(async (tx) => {
      for (const b of balances) {
        const exists = await tx.query('SELECT 1 FROM products WHERE id = $1', [b.produto.id]);
        if (exists.rowCount === 0) continue;
        for (const d of b.depositos ?? []) {
          await ensureDeposit(tx, d.id, source);
          await tx.query(
            `INSERT INTO stock_balances (product_id, deposit_id, physical, virtual, fetched_at, source)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (product_id, deposit_id) DO UPDATE SET physical = EXCLUDED.physical,
               virtual = EXCLUDED.virtual, fetched_at = EXCLUDED.fetched_at, source = EXCLUDED.source`,
            [b.produto.id, d.id, d.saldoFisico, d.saldoVirtual, fetchedAt, source],
          );
          count++;
        }
      }
    });
  }
  return count;
}

export async function syncAllBalances(client: BlingClient, triggeredBy = 'system') {
  return recordAttempt('balances', triggeredBy, async () => {
    const { rows } = await pool.query<{ id: number }>("SELECT id FROM products WHERE active AND format <> 'V' ORDER BY id");
    const items = await refreshBalances(client, rows.map((r) => r.id));
    return { items };
  });
}

// ------------------------------------------------------------------ pedidos de venda
export type UpsertOutcome = 'applied' | 'stale' | 'deleted';

/**
 * Aplica o estado de um pedido de venda. `observedAt` é o instante em que o estado foi
 * observado (data do evento ou da consulta). Estados mais antigos que o último aplicado
 * são descartados — proteção contra eventos fora de ordem.
 */
export async function upsertSalesOrder(
  order: BlingSalesOrderDetail,
  observedAt: Date,
  origin: string,
  source: string,
): Promise<UpsertOutcome> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<{ last_event_at: Date | null; situation_id: number | null }>(
      'SELECT last_event_at, situation_id FROM sales_orders WHERE id = $1 FOR UPDATE',
      [order.id],
    );
    const existing = rows[0];
    if (existing?.last_event_at && existing.last_event_at.getTime() > observedAt.getTime()) return 'stale';

    const situationId = order.situacao?.id ?? null;
    await tx.query(
      `INSERT INTO sales_orders (id, number, order_date, expected_date, ship_date, situation_id, customer_id, customer_name,
         seller_id, store_id, total, deleted, last_event_at, synced_at, source, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12, now(), $13, $14)
       ON CONFLICT (id) DO UPDATE SET number = EXCLUDED.number, order_date = EXCLUDED.order_date,
         expected_date = EXCLUDED.expected_date, ship_date = EXCLUDED.ship_date, situation_id = EXCLUDED.situation_id,
         customer_id = EXCLUDED.customer_id, customer_name = EXCLUDED.customer_name, seller_id = EXCLUDED.seller_id,
         store_id = EXCLUDED.store_id, total = EXCLUDED.total, deleted = false, last_event_at = EXCLUDED.last_event_at,
         synced_at = now(), source = EXCLUDED.source, raw = EXCLUDED.raw`,
      [
        order.id,
        order.numero ?? null,
        validDate(order.data),
        validDate(order.dataPrevista),
        validDate(order.dataSaida),
        situationId,
        order.contato?.id ?? null,
        order.contato?.nome ?? null,
        order.vendedor?.id || null,
        order.loja?.id || null,
        order.total ?? null,
        observedAt,
        source,
        JSON.stringify(order),
      ],
    );
    if (!existing || existing.situation_id !== situationId) {
      await tx.query('INSERT INTO sales_order_situation_history (order_id, situation_id, origin) VALUES ($1, $2, $3)', [order.id, situationId, origin]);
    }
    if (order.itens) {
      await tx.query('DELETE FROM sales_order_items WHERE order_id = $1', [order.id]);
      for (const it of order.itens) {
        await tx.query(
          `INSERT INTO sales_order_items (id, order_id, product_id, sku, description, quantity, unit)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET order_id = EXCLUDED.order_id, product_id = EXCLUDED.product_id, sku = EXCLUDED.sku,
             description = EXCLUDED.description, quantity = EXCLUDED.quantity, unit = EXCLUDED.unit`,
          [it.id, order.id, it.produto?.id || null, it.codigo ?? null, it.descricao ?? null, it.quantidade, it.unidade ?? null],
        );
      }
    }
    return 'applied';
  });
}

export async function markSalesOrderDeleted(orderId: number, observedAt: Date): Promise<UpsertOutcome> {
  const res = await pool.query(
    `UPDATE sales_orders SET deleted = true, last_event_at = $2, synced_at = now()
     WHERE id = $1 AND (last_event_at IS NULL OR last_event_at <= $2)`,
    [orderId, observedAt],
  );
  return res.rowCount ? 'deleted' : 'stale';
}

/** Busca o pedido na API (fonte da verdade) e aplica. */
export async function refreshSalesOrder(client: BlingClient, orderId: number, origin: string): Promise<UpsertOutcome> {
  const observedAt = new Date();
  const detail = await client.getSalesOrder(orderId);
  if (!detail) return markSalesOrderDeleted(orderId, observedAt);
  return upsertSalesOrder(detail, observedAt, origin, sourceOf(client));
}

function formatBlingDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Sincronização incremental de pedidos alterados desde a última execução (com margem de 1 dia,
 * pois o filtro do Bling é por data e o horário da conta pode diferir de UTC).
 */
export async function syncSalesOrders(client: BlingClient, opts: { full?: boolean } = {}, triggeredBy = 'system') {
  return recordAttempt('sales_orders', triggeredBy, async () => {
    const settings = await getSettings();
    const { rows } = await pool.query<{ last_success_at: Date | null }>("SELECT last_success_at FROM sync_state WHERE resource = 'sales_orders'");
    const last = rows[0]?.last_success_at;
    const since = opts.full || !last
      ? new Date(Date.now() - settings.sync.initialLookbackDays * 86400000)
      : new Date(last.getTime() - 86400000);
    let count = 0;
    const ids: number[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const items = await client.listSalesOrders({ pagina: page, limite: 100, dataAlteracaoInicial: formatBlingDate(since) });
      ids.push(...items.map((o) => o.id));
      if (items.length < 100) break;
    }
    for (const id of ids) {
      await refreshSalesOrder(client, id, 'sync');
      count++;
    }
    return { items: count };
  });
}

/**
 * Reconciliação: confere se todos os pedidos que o sistema considera "comprometendo estoque"
 * continuam nessa situação no Bling. Pedidos ativos localmente mas ausentes da lista do Bling
 * são consultados individualmente (podem ter mudado de situação ou sido excluídos).
 */
export async function reconcileSalesOrders(client: BlingClient, triggeredBy = 'system') {
  return recordAttempt('reconcile_orders', triggeredBy, async () => {
    const { rows: sit } = await pool.query<{ situation_id: number }>(
      "SELECT situation_id FROM situation_rules WHERE category IN ('COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY')",
    );
    const activeSituations = sit.map((r) => r.situation_id);
    const remoteIds = new Set<number>();
    if (activeSituations.length) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const items = await client.listSalesOrders({ pagina: page, limite: 100, idsSituacoes: activeSituations });
        for (const o of items) remoteIds.add(o.id);
        if (items.length < 100) break;
      }
    }
    // pedidos locais em situação ativa ou sem regra (conservador)
    const { rows: local } = await pool.query<{ id: number }>(
      `SELECT o.id FROM sales_orders o LEFT JOIN situation_rules r ON r.situation_id = o.situation_id
       WHERE NOT o.deleted AND (r.situation_id IS NULL OR r.category IN ('COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY'))`,
    );
    const localIds = new Set(local.map((r) => r.id));
    let touched = 0;
    for (const id of localIds) {
      if (!remoteIds.has(id)) {
        await refreshSalesOrder(client, id, 'reconcile');
        touched++;
      }
    }
    for (const id of remoteIds) {
      if (!localIds.has(id)) {
        await refreshSalesOrder(client, id, 'reconcile');
        touched++;
      }
    }
    return { items: touched };
  });
}

// ------------------------------------------------------------------ pedidos de compra (entradas previstas)
async function upsertPurchaseOrder(db: pg.PoolClient, po: BlingPurchaseOrderDetail, source: string) {
  await db.query(
    `INSERT INTO purchase_orders (id, number, order_date, expected_date, situation_value, supplier_id, supplier_name, synced_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)
     ON CONFLICT (id) DO UPDATE SET number = EXCLUDED.number, order_date = EXCLUDED.order_date, expected_date = EXCLUDED.expected_date,
       situation_value = EXCLUDED.situation_value, supplier_id = EXCLUDED.supplier_id,
       supplier_name = COALESCE(EXCLUDED.supplier_name, purchase_orders.supplier_name), synced_at = now(), source = EXCLUDED.source`,
    [po.id, po.numero ?? null, validDate(po.data), validDate(po.dataPrevista), po.situacao?.valor ?? null, po.fornecedor?.id ?? null, po.fornecedor?.nome ?? null, source],
  );
  if (po.itens) {
    await db.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [po.id]);
    let line = 0;
    for (const it of po.itens) {
      line++;
      await db.query(
        `INSERT INTO purchase_order_items (purchase_order_id, line_no, product_id, sku, description, quantity) VALUES ($1, $2, $3, $4, $5, $6)`,
        [po.id, line, it.produto?.id || null, it.produto?.codigo ?? null, it.descricao ?? null, it.quantidade ?? 0],
      );
    }
  }
}

export async function syncPurchaseOrders(client: BlingClient, triggeredBy = 'system') {
  return recordAttempt('purchase_orders', triggeredBy, async () => {
    const remote = new Set<number>();
    // 0 = em aberto, 3 = em andamento
    for (const valorSituacao of [0, 3]) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const items = await client.listPurchaseOrders({ pagina: page, limite: 100, valorSituacao });
        for (const po of items) remote.add(po.id);
        if (items.length < 100) break;
      }
    }
    const { rows } = await pool.query<{ id: number }>('SELECT id FROM purchase_orders WHERE situation_value IN (0, 3)');
    const ids = new Set([...remote, ...rows.map((r) => r.id)]);
    let count = 0;
    for (const id of ids) {
      const detail = await client.getPurchaseOrder(id);
      if (!detail) {
        await pool.query('UPDATE purchase_orders SET situation_value = 2, synced_at = now() WHERE id = $1', [id]);
        continue;
      }
      await withTransaction((tx) => upsertPurchaseOrder(tx, detail, sourceOf(client)));
      count++;
    }
    return { items: count };
  });
}

// ------------------------------------------------------------------ orquestração
export async function runFullSync(client: BlingClient, triggeredBy = 'system') {
  await syncDeposits(client, triggeredBy);
  await syncSituations(client, triggeredBy);
  await syncProducts(client, {}, triggeredBy);
  await syncAllBalances(client, triggeredBy);
  await syncSalesOrders(client, { full: true }, triggeredBy);
  await syncPurchaseOrders(client, triggeredBy);
}

export async function runIncrementalSync(client: BlingClient, triggeredBy = 'system') {
  const { rows } = await pool.query<{ last_success_at: Date | null }>("SELECT last_success_at FROM sync_state WHERE resource = 'products'");
  const last = rows[0]?.last_success_at;
  if (!last) return runFullSync(client, triggeredBy);
  await syncProducts(client, { since: formatBlingDate(new Date(last.getTime() - 86400000)) }, triggeredBy);
  await syncSalesOrders(client, {}, triggeredBy);
  await syncAllBalances(client, triggeredBy);
  await syncPurchaseOrders(client, triggeredBy);
}

function validDate(s: string | undefined | null): string | null {
  if (!s || s.startsWith('0000')) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
