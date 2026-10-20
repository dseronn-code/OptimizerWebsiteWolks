import pg from 'pg';
import { config } from '../config.js';

// numeric -> number (quantidades de estoque cabem com folga em double; arredondamos no motor)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// int8 -> number (ids do Bling cabem em 2^53)
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date -> string 'YYYY-MM-DD' (evita deslocamento de fuso)
pg.types.setTypeParser(1082, (v) => v);

export type Db = pg.Pool | pg.PoolClient;

export let pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

/** Usado pelos testes para apontar para outro banco. */
export function setPool(p: pg.Pool) {
  pool = p;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
