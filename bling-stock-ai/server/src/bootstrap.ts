import { createUser } from './auth/authService.js';
import { config, isProduction } from './config.js';
import { pool } from './db/pool.js';

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
  const username = config.BOOTSTRAP_ADMIN_USERNAME?.trim().toLowerCase();
  if (username && config.BOOTSTRAP_ADMIN_PASSWORD) {
    const exists = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (exists.rowCount === 0) {
      await createUser({ username, name: 'Administrador', password: config.BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' });
      log(`administrador "${username}" criado`);
    }
  }
}
