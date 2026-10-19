import { pool } from '../db/pool.js';

/**
 * Fila de jobs persistida no PostgreSQL (FOR UPDATE SKIP LOCKED), com retentativa
 * exponencial e deduplicação de jobs pendentes pela chave `dedupe_key`.
 */

export type JobHandler = (payload: any) => Promise<void>;

export async function enqueue(type: string, payload: unknown = {}, opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {}) {
  await pool.query(
    `INSERT INTO jobs (type, payload, dedupe_key, run_at, max_attempts) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (dedupe_key) WHERE status IN ('pending', 'running') AND dedupe_key IS NOT NULL DO NOTHING`,
    [type, JSON.stringify(payload), opts.dedupeKey ?? null, opts.runAt ?? new Date(), opts.maxAttempts ?? 6],
  );
}

interface JobRow {
  id: number;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

export function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/** Processa até `limit` jobs prontos. Retorna quantos foram processados. */
export async function runDueJobs(handlers: Record<string, JobHandler>, limit = 10): Promise<number> {
  // jobs presos em "running" por mais de 15 min (processo caiu) voltam para a fila
  await pool.query("UPDATE jobs SET status = 'pending', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '15 minutes'");
  let processed = 0;
  for (; processed < limit; processed++) {
    const { rows } = await pool.query<JobRow>(
      `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
       WHERE id = (SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now() ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING id, type, payload, attempts, max_attempts`,
    );
    const job = rows[0];
    if (!job) break;
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`Sem handler para o job ${job.type}`);
      await handler(job.payload);
      await pool.query("UPDATE jobs SET status = 'done', finished_at = now(), last_error = NULL WHERE id = $1", [job.id]);
    } catch (err) {
      const msg = (err as Error).message?.slice(0, 500) ?? String(err);
      if (job.attempts >= job.max_attempts) {
        await pool.query("UPDATE jobs SET status = 'failed', finished_at = now(), last_error = $2 WHERE id = $1", [job.id, msg]);
      } else {
        await pool.query(
          "UPDATE jobs SET status = 'pending', locked_at = NULL, last_error = $2, run_at = now() + ($3 || ' milliseconds')::interval WHERE id = $1",
          [job.id, msg, String(retryDelayMs(job.attempts))],
        );
      }
    }
  }
  return processed;
}
