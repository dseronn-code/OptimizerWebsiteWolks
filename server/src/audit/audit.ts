import type { Db } from '../db/pool.js';
import { pool } from '../db/pool.js';

export async function audit(
  entry: { userId?: string | null; action: string; entity?: string; entityId?: string | number | null; details?: unknown; ip?: string | null },
  db: Db = pool,
): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6)',
    [entry.userId ?? null, entry.action, entry.entity ?? null, entry.entityId != null ? String(entry.entityId) : null, entry.details ? JSON.stringify(entry.details) : null, entry.ip ?? null],
  );
}
