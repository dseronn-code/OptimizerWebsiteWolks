import { createUser } from './auth/authService.js';
import { config, isProduction } from './config.js';
import { pool } from './db/pool.js';
import { purgeDemoData } from './demo/purge.js';
import { enqueue } from './sync/jobs.js';
import { getSettings } from './lib/settings.js';

const DEMO_USERNAMES = ['admin', 'gestor', 'ana', 'bruno'];

/**
 * Primeira inicialização (útil em hospedagens sem acesso a terminal):
 *  - SEED_DEMO_IF_EMPTY=true → banco sem usuários recebe o ambiente de demonstração;
 *  - BOOTSTRAP_ADMIN_USERNAME/PASSWORD → cria esse administrador se ele ainda não existir.
 * Nada é feito se o banco já tiver usuários (exceto criar o admin indicado, se faltar).
 */
export async function bootstrap(log: (msg: string) => void): Promise<void> {
  const { rows } = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0 && config.SEED_DEMO_IF_EMPTY) {
    // Em servidor público, as senhas fixas da demonstração não podem ser usadas.
    if (isProduction && !config.BOOTSTRAP_ADMIN_PASSWORD) {
      log('SEED_DEMO_IF_EMPTY ignorado: defina BOOTSTRAP_ADMIN_PASSWORD para usar a demonstração em produção');
    } else {
      const { seedDemo } = await import('./demo/seed.js');
      await seedDemo(log, isProduction ? config.BOOTSTRAP_ADMIN_PASSWORD : undefined);
    }
  }
  // Em modo Bling real, garante que nenhum dado fictício da demonstração permaneça no banco.
  if ((await getSettings()).appMode === 'live') {
    // Uma releitura do catálogo após atualizações que adicionam campos de produto (tipo do item, kits).
    const marker = 'products_backfill_v2';
    const done = await pool.query('SELECT 1 FROM sync_state WHERE resource = $1', [marker]);
    const connected = await pool.query("SELECT 1 FROM bling_connection WHERE status = 'connected'");
    if (!done.rowCount && connected.rowCount) {
      await enqueue('sync_products_full', { marker }, { dedupeKey: 'sync_products_full', maxAttempts: 3 });
      log('releitura do catálogo agendada');
    }
    const purged = await purgeDemoData();
    if (purged.removedProducts) log(`dados de demonstração removidos (${purged.removedProducts} produtos fictícios)`);
    // Usuários de demonstração usam senha compartilhada: são desativados no uso real,
    // desde que exista outro administrador ativo (para ninguém ficar trancado para fora).
    const otherAdmin = await pool.query(
      "SELECT 1 FROM users WHERE role = 'admin' AND active AND NOT pending_approval AND NOT (username = ANY($1) AND name LIKE '%(demo)%') LIMIT 1",
      [DEMO_USERNAMES],
    );
    if (otherAdmin.rowCount) {
      const off = await pool.query(
        "UPDATE users SET active = false, updated_at = now() WHERE active AND username = ANY($1) AND name LIKE '%(demo)%' RETURNING username",
        [DEMO_USERNAMES],
      );
      if (off.rowCount) {
        await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ANY($1) AND NOT active)', [DEMO_USERNAMES]);
        log(`usuários de demonstração desativados: ${off.rows.map((r) => r.username).join(', ')}`);
      }
    }
  }

  const username = config.BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase();
  if (username && config.BOOTSTRAP_ADMIN_PASSWORD) {
    const exists = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (exists.rowCount === 0) {
      await createUser({ username, name: 'Administrador', password: config.BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' });
      log(`administrador "${username}" criado`);
    }
  }
}
