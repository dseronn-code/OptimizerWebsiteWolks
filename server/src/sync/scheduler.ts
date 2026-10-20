import { pool } from '../db/pool.js';
import { getSettings } from '../lib/settings.js';
import { enqueue, runDueJobs } from './jobs.js';
import { jobHandlers } from './processors.js';

async function lastSuccess(resource: string): Promise<Date | null> {
  const { rows } = await pool.query<{ last_success_at: Date | null }>('SELECT last_success_at FROM sync_state WHERE resource = $1', [resource]);
  return rows[0]?.last_success_at ?? null;
}

function due(last: Date | null, minutes: number): boolean {
  return !last || Date.now() - last.getTime() >= minutes * 60000;
}

/** Agenda as rotinas periódicas (idempotente graças à deduplicação da fila). */
export async function scheduleTick(): Promise<void> {
  const s = await getSettings();
  const { rows } = await pool.query("SELECT status FROM bling_connection WHERE id = 1");
  const canSync = s.appMode === 'demo' || rows[0]?.status === 'connected';
  if (canSync) {
    if (due(await lastSuccess('sales_orders'), s.sync.incrementalMinutes)) {
      await enqueue('sync_incremental', { triggeredBy: 'agendado' }, { dedupeKey: 'sync_incremental', maxAttempts: 3 });
    }
    if (due(await lastSuccess('reconcile_orders'), s.sync.reconcileMinutes)) {
      await enqueue('reconcile', { triggeredBy: 'agendado' }, { dedupeKey: 'reconcile', maxAttempts: 3 });
    }
  }
  await enqueue('expire_reservations', {}, { dedupeKey: 'expire_reservations', maxAttempts: 2 });
  if (due(await lastSuccess('alerts_scan'), 5)) {
    await enqueue('alerts_scan', {}, { dedupeKey: 'alerts_scan', maxAttempts: 2 });
  }
}

export function startWorker(log: (msg: string, err?: unknown) => void = console.log): () => void {
  let stopped = false;
  let busy = false;
  const loop = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      await runDueJobs(jobHandlers, 20);
    } catch (err) {
      log('erro no processamento de jobs', err);
    } finally {
      busy = false;
    }
  };
  const tick = async () => {
    try {
      await scheduleTick();
    } catch (err) {
      log('erro no agendador', err);
    }
  };
  void tick();
  const a = setInterval(loop, 2000);
  const b = setInterval(tick, 60000);
  return () => {
    stopped = true;
    clearInterval(a);
    clearInterval(b);
  };
}
