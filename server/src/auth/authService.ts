import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { pool } from '../db/pool.js';
import { randomToken, sha256 } from '../lib/crypto.js';

export type Role = 'vendedor' | 'gestor' | 'admin';

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  blingSellerId: number | null;
}

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Hash fixo usado quando o usuário não existe, para igualar o tempo de resposta.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

export function validatePasswordPolicy(pw: string): string | null {
  if (pw.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'A senha deve conter letras e números.';
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export async function createUser(
  u: { username: string; name: string; password: string; role: Role; blingSellerId?: number | null },
  db: Db = pool,
): Promise<SessionUser> {
  const policy = validatePasswordPolicy(u.password);
  if (policy) throw new Error(policy);
  const { rows } = await db.query(
    `INSERT INTO users (username, name, password_hash, role, bling_seller_id) VALUES (lower($1), $2, $3, $4, $5)
     RETURNING id, username, name, role, bling_seller_id`,
    [u.username.trim(), u.name.trim(), await hashPassword(u.password), u.role, u.blingSellerId ?? null],
  );
  return toSessionUser(rows[0]);
}

function toSessionUser(r: any): SessionUser {
  return { id: r.id, username: r.username, name: r.name, role: r.role, blingSellerId: r.bling_seller_id };
}

export type LoginResult = { ok: true; user: SessionUser; token: string; expiresAt: Date } | { ok: false; reason: 'invalid' | 'locked' | 'pending' };

export async function login(username: string, password: string, meta: { ip?: string; userAgent?: string }): Promise<LoginResult> {
  // aceita o nome de usuário ou o e-mail
  const { rows } = await pool.query('SELECT * FROM users WHERE username = lower($1) OR lower(email) = lower($1) ORDER BY (username = lower($1)) DESC LIMIT 1', [username.trim()]);
  const u = rows[0];
  if (!u || (!u.active && !u.pending_approval)) {
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false, reason: 'invalid' };
  }
  if (u.locked_until && u.locked_until > new Date()) return { ok: false, reason: 'locked' };
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    const failed = u.failed_logins + 1;
    const lock = failed >= MAX_FAILED;
    await pool.query('UPDATE users SET failed_logins = $2, locked_until = COALESCE($3, locked_until) WHERE id = $1', [
      u.id,
      lock ? 0 : failed,
      lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
    ]);
    return { ok: false, reason: failed >= MAX_FAILED ? 'locked' : 'invalid' };
  }
  await pool.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
  // senha correta, mas a conta criada pelo cadastro ainda não foi aprovada
  if (u.pending_approval) return { ok: false, reason: 'pending' };
  const { token, expiresAt } = await createSession(u.id, meta);
  return { ok: true, user: toSessionUser(u), token, expiresAt };
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600000);
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)', [
    sha256(token), userId, expiresAt, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null,
  ]);
  return { token, expiresAt };
}

export async function getUserById(id: string): Promise<SessionUser | null> {
  const { rows } = await pool.query('SELECT id, username, name, role, bling_seller_id FROM users WHERE id = $1 AND active', [id]);
  return rows[0] ? toSessionUser(rows[0]) : null;
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const { rows } = await pool.query(
    `UPDATE sessions s SET last_seen = now(),
       expires_at = GREATEST(s.expires_at, now() + ($2 || ' hours')::interval / 2)
     FROM users u WHERE s.token_hash = $1 AND u.id = s.user_id AND s.expires_at > now() AND u.active
     RETURNING u.id, u.username, u.name, u.role, u.bling_seller_id`,
    [sha256(token), String(config.SESSION_TTL_HOURS)],
  );
  return rows[0] ? toSessionUser(rows[0]) : null;
}

export async function logout(token: string | undefined) {
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export async function revokeUserSessions(userId: string) {
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function changePassword(userId: string, current: string, next: string) {
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) throw new Error('Senha atual incorreta.');
  const policy = validatePasswordPolicy(next);
  if (policy) throw new Error(policy);
  await pool.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [userId, await hashPassword(next)]);
}
