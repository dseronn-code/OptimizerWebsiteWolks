import { getBlingClient } from '../bling/clientFactory.js';
import { pool } from '../db/pool.js';
import { scanAlerts } from '../alerts/alertService.js';
import { expireReservations } from '../reservations/reservationService.js';
import { invalidateProductCache } from '../stock/productSearch.js';
import { enqueue, type JobHandler } from './jobs.js';
import {
  reconcileSalesOrders,
  refreshBalances,
  refreshSalesOrder,
  runFullSync,
  runIncrementalSync,
  syncProducts,
} from './syncService.js';

/** Processa um webhook registrado: consulta o recurso na API e aplica, respeitando a ordem. */
export async function processWebhookEvent(eventId: string): Promise<string> {
  const { rows } = await pool.query('SELECT * FROM webhook_events WHERE event_id = $1', [eventId]);
  const ev = rows[0];
  if (!ev || ev.status === 'processed' || ev.status === 'ignored') return 'skip';
  const client = await getBlingClient();
  let note = '';
  if (ev.resource === 'sales_order') {
    const cur = await pool.query<{ last_event_at: Date | null }>('SELECT last_event_at FROM sales_orders WHERE id = $1', [ev.resource_id]);
    const lastApplied = cur.rows[0]?.last_event_at;
    if (lastApplied && ev.event_date && lastApplied.getTime() > ev.event_date.getTime()) {
      await pool.query("UPDATE webhook_events SET status = 'ignored', processed_at = now(), note = $2 WHERE event_id = $1", [
        eventId,
        'evento mais antigo que o estado já aplicado (fora de ordem)',
      ]);
      return 'stale';
    }
    note = await refreshSalesOrder(client, ev.resource_id, 'webhook');
    // O pedido pode ter mudado a situação de estoque: atualiza também os saldos dos itens.
    const items = await pool.query<{ product_id: number }>('SELECT DISTINCT product_id FROM sales_order_items WHERE order_id = $1 AND product_id IS NOT NULL', [ev.resource_id]);
    if (items.rows.length) await refreshBalances(client, items.rows.map((r) => r.product_id));
  } else if (ev.resource === 'stock') {
    note = `saldos atualizados: ${await refreshBalances(client, [ev.resource_id])}`;
  } else if (ev.resource === 'product') {
    await enqueue('sync_products_incremental', {}, { dedupeKey: 'sync_products_incremental' });
    await refreshBalances(client, [ev.resource_id]);
    note = 'produto agendado para sincronização';
  }
  await pool.query("UPDATE webhook_events SET status = 'processed', processed_at = now(), note = $2 WHERE event_id = $1", [eventId, note]);
  return note;
}

export const jobHandlers: Record<string, JobHandler> = {
  async process_webhook(p: { eventId: string }) {
    try {
      await processWebhookEvent(p.eventId);
    } catch (err) {
      await pool.query("UPDATE webhook_events SET status = 'failed', note = $2 WHERE event_id = $1", [p.eventId, (err as Error).message]);
      throw err; // a fila fará nova tentativa
    }
  },
  async sync_full(p: { triggeredBy?: string }) {
    await runFullSync(await getBlingClient(), p.triggeredBy ?? 'agendado');
    await reconcileSalesOrders(await getBlingClient(), p.triggeredBy ?? 'agendado');
    invalidateProductCache();
  },
  async sync_incremental(p: { triggeredBy?: string }) {
    await runIncrementalSync(await getBlingClient(), p.triggeredBy ?? 'agendado');
    invalidateProductCache();
  },
  async sync_products_incremental() {
    const since = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await syncProducts(await getBlingClient(), { since }, 'webhook');
    invalidateProductCache();
  },
  async reconcile(p: { triggeredBy?: string }) {
    await reconcileSalesOrders(await getBlingClient(), p.triggeredBy ?? 'agendado');
  },
  async alerts_scan() {
    await scanAlerts();
  },
  async expire_reservations() {
    await expireReservations();
  },
};
