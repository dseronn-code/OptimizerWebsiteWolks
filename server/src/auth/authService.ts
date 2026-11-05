import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { upsertAlert } from '../alerts/alertService.js';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { pool, withTransaction } from '../db/pool.js';
import { decrypt, encrypt, randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { getSettings } from '../lib/settings.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp.js';

export type Role = 'vendedor' | 'gestor' | 'admin';

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  blingSellerId: number | null;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const MFA_CHALLENGE_MINUTES = 10;
const MFA_MAX_ATTEMPTS = 5;
/** Tempo máximo de uma sessão, mesmo em uso contínuo (depois disso, novo login). */
const ABSOLUTE_SESSION_HOURS = { privileged: 24, vendedor: 24 * 7 };
// Hash fixo usado quando o usuário não existe, para igualar o tempo de resposta.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

const COMMON_PASSWORDS = new Set([
  '1234567890', '0123456789', '12345678910', 'senha12345', 'senha123456', 'password123', 'password1234', 'qwerty1234',
  'qwerty12345', 'admin12345', 'admin123456', 'abc1234567', 'abcd123456', 'mudar12345', 'teste12345', 'itcomtech1',
  'itcomtech123', 'itcomtech2026', 'bling123456', 'estoque123', 'brasil1234', 'iloveyou12', '1q2w3e4r5t',
]);

export function validatePasswordPolicy(pw: string, identity: string[] = []): string | null {
  if (pw.length < 10) return 'A senha deve ter pelo menos 10 caracteres.';
  if (pw.length > 200) return 'Senha longa demais.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'A senha deve conter letras e números.';
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'Essa senha é muito comum. Escolha outra.';
  if (/^(.)\1+$/.test(pw)) return 'A senha não pode repetir o mesmo caractere.';
  for (const id of identity) {
    const part = id.toLowerCase().split('@')[0];
    if (part.length >= 4 && lower.includes(part)) return 'A senha não pode conter seu usuário ou e-mail.';
  }
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export async function createUser(
  u: { username: string; name: string; password: string; role: Role; blingSellerId?: number | null },
  db: Db = pool,
): Promise<SessionUser> {
  const policy = validatePasswordPolicy(u.password, [u.username]);
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

type Meta = { ip?: string; userAgent?: string };

export type LoginResult =
  | { ok: true; user: SessionUser; token: string; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'locked' | 'pending' }
  | { ok: false; reason: 'mfa'; mfa: 'verify' | 'setup'; challenge: string };

export async function login(username: string, password: string, meta: Meta): Promise<LoginResult> {
  // aceita o nome de usuário ou o e-mail
  const { rows } = await pool.query('SELECT * FROM users WHERE username = lower($1) OR lower(email) = lower($1) ORDER BY (username = lower($1)) DESC LIMIT 1', [username.trim()]);
  const u = rows[0];
  if (!u || (!u.active && !u.pending_approval)) {
    await bcrypt.compare(password, DUMMY_HASH);
    await noteFailedLogin(meta.ip);
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
    await noteFailedLogin(meta.ip);
    if (lock && u.role !== 'vendedor') {
      await upsertAlert({
        type: 'SECURITY_ACCOUNT_LOCKED', severity: 'critical', dedupeKey: `account_locked:${u.id}:${new Date().toISOString().slice(0, 13)}`,
        message: `A conta "${u.username}" (${u.role}) foi bloqueada por ${MAX_FAILED} senhas erradas seguidas (IP ${meta.ip ?? 'desconhecido'}).`,
      });
    }
    return { ok: false, reason: lock ? 'locked' : 'invalid' };
  }
  await pool.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
  // senha correta, mas a conta criada pelo cadastro ainda não foi aprovada
  if (u.pending_approval) return { ok: false, reason: 'pending' };

  // Verificação em duas etapas: obrigatória para os perfis configurados, ou se o usuário já ativou.
  const settings = await getSettings();
  if (u.totp_enabled_at) return { ok: false, reason: 'mfa', mfa: 'verify', challenge: await createChallenge(u.id, 'verify', meta) };
  if (settings.security.mfaRequiredFor.includes(u.role)) {
    return { ok: false, reason: 'mfa', mfa: 'setup', challenge: await createChallenge(u.id, 'setup', meta) };
  }
  return finishLogin(u, meta);
}

async function finishLogin(u: any, meta: Meta): Promise<{ ok: true; user: SessionUser; token: string; expiresAt: Date }> {
  const { token, expiresAt } = await createSession(u.id, meta);
  await alertIfNewLocation(u, meta);
  return { ok: true, user: toSessionUser(u), token, expiresAt };
}

export async function createSession(userId: string, meta: Meta) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600000);
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)', [
    sha256(token), userId, expiresAt, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null,
  ]);
  return { token, expiresAt };
}

// ------------------------------------------------------------------ verificação em duas etapas (TOTP)
async function createChallenge(userId: string, purpose: 'verify' | 'setup', meta: Meta): Promise<string> {
  const token = randomToken(32);
  await pool.query('DELETE FROM mfa_challenges WHERE user_id = $1 OR expires_at < now()', [userId]);
  await pool.query(
    `INSERT INTO mfa_challenges (token_hash, user_id, purpose, ip, expires_at) VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval)`,
    [sha256(token), userId, purpose, meta.ip ?? null, String(MFA_CHALLENGE_MINUTES)],
  );
  return token;
}

async function loadChallenge(token: string, purpose: 'verify' | 'setup') {
  const { rows } = await pool.query(
    `SELECT c.*, u.username, u.name, u.role, u.bling_seller_id, u.id AS uid, u.active, u.totp_secret_enc, u.totp_last_counter, u.recovery_codes
     FROM mfa_challenges c JOIN users u ON u.id = c.user_id WHERE c.token_hash = $1`,
    [sha256(token)],
  );
  const c = rows[0];
  if (!c || c.expires_at < new Date() || !c.active) throw new AuthError('A verificação expirou. Entre novamente com usuário e senha.', 401);
  if (c.purpose !== purpose) throw new AuthError('Etapa de verificação inválida.', 400);
  if (c.attempts >= MFA_MAX_ATTEMPTS) {
    await pool.query('DELETE FROM mfa_challenges WHERE token_hash = $1', [sha256(token)]);
    throw new AuthError('Muitos códigos errados. Entre novamente com usuário e senha.', 429);
  }
  return c;
}

async function failChallenge(token: string, c: any, ip?: string): Promise<never> {
  await pool.query('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = $1', [sha256(token)]);
  if (c.attempts + 1 >= 3) {
    await upsertAlert({
      type: 'SECURITY_MFA_FAILED', severity: 'warning', dedupeKey: `mfa_failed:${c.user_id}:${new Date().toISOString().slice(0, 13)}`,
      message: `Senha correta, mas códigos de verificação errados na conta "${c.username}" (IP ${ip ?? 'desconhecido'}). Se não foi você, troque a senha.`,
    });
  }
  const left = MFA_MAX_ATTEMPTS - c.attempts - 1;
  throw new AuthError(left > 0 ? `Código incorreto. Restam ${left} tentativa(s).` : 'Código incorreto. Entre novamente com usuário e senha.', 401);
}

/** Etapa 2 do login: código do app autenticador ou código de recuperação. */
export async function verifyMfa(challenge: string, code: string, meta: Meta) {
  const c = await loadChallenge(challenge, 'verify');
  const clean = code.trim().toUpperCase();
  let usedCounter: number | null = null;
  let recoveryLeft: string[] | null = null;
  if (/^\d{6}$/.test(clean)) {
    usedCounter = verifyTotp(decrypt(c.totp_secret_enc), clean, c.totp_last_counter);
    if (usedCounter === null) return failChallenge(challenge, c, meta.ip);
  } else {
    const hashes: string[] = c.recovery_codes ?? [];
    const h = sha256(clean.replace(/[^A-Z0-9]/g, ''));
    const match = hashes.find((x) => safeEqual(x, h));
    if (!match) return failChallenge(challenge, c, meta.ip);
    recoveryLeft = hashes.filter((x) => x !== match);
  }
  await withTransaction(async (tx) => {
    await tx.query('DELETE FROM mfa_challenges WHERE token_hash = $1', [sha256(challenge)]);
    if (usedCounter !== null) await tx.query('UPDATE users SET totp_last_counter = $2 WHERE id = $1', [c.user_id, usedCounter]);
    if (recoveryLeft) await tx.query('UPDATE users SET recovery_codes = $2 WHERE id = $1', [c.user_id, JSON.stringify(recoveryLeft)]);
  });
  if (recoveryLeft) {
    await upsertAlert({
      type: 'SECURITY_RECOVERY_CODE_USED', severity: 'warning', dedupeKey: `recovery_used:${c.user_id}:${Date.now()}`,
      message: `A conta "${c.username}" entrou usando um código de recuperação (restam ${recoveryLeft.length}).`,
    });
  }
  return { ...(await finishLogin({ ...c, id: c.user_id }, meta)), recoveryCodesLeft: recoveryLeft?.length ?? null };
}

/** Primeiro acesso de perfil que exige 2FA: gera o segredo e o QR Code para o app autenticador. */
export async function startMfaSetup(challenge: string) {
  const c = await loadChallenge(challenge, 'setup');
  const secret = generateTotpSecret();
  await pool.query('UPDATE mfa_challenges SET setup_secret_enc = $2 WHERE token_hash = $1', [sha256(challenge), encrypt(secret)]);
  const url = otpauthUrl(secret, c.username, config.EMAIL_FROM_NAME || 'ITCOMTECH Estoque');
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 240 }) };
}

function newRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: 8 }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase(); // 10 caracteres
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { plain, hashes: plain.map((p) => sha256(p.replace(/-/g, ''))) };
}

export async function confirmMfaSetup(challenge: string, code: string, meta: Meta) {
  const c = await loadChallenge(challenge, 'setup');
  if (!c.setup_secret_enc) throw new AuthError('Gere o QR Code antes de confirmar.', 400);
  const secret = decrypt(c.setup_secret_enc);
  const counter = verifyTotp(secret, code.trim(), null);
  if (counter === null) return failChallenge(challenge, c, meta.ip);
  const codes = newRecoveryCodes();
  await withTransaction(async (tx) => {
    await tx.query(
      'UPDATE users SET totp_secret_enc = $2, totp_enabled_at = now(), totp_last_counter = $3, recovery_codes = $4, updated_at = now() WHERE id = $1',
      [c.user_id, encrypt(secret), counter, JSON.stringify(codes.hashes)],
    );
    await tx.query('DELETE FROM mfa_challenges WHERE token_hash = $1', [sha256(challenge)]);
  });
  const result = await finishLogin({ ...c, id: c.user_id }, meta);
  return { ...result, recoveryCodes: codes.plain };
}

export async function resetMfa(userId: string) {
  await pool.query('UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_counter = NULL, recovery_codes = NULL WHERE id = $1', [userId]);
  await revokeUserSessions(userId);
}

// ------------------------------------------------------------------ alertas de segurança
async function noteFailedLogin(ip?: string) {
  // muitas falhas em pouco tempo indicam tentativa de invasão (força bruta)
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM audit_log WHERE action IN ('auth.failed', 'auth.locked') AND at > now() - interval '15 minutes'",
  );
  if (rows[0].n + 1 >= 20) {
    await upsertAlert({
      type: 'SECURITY_BRUTE_FORCE', severity: 'critical', dedupeKey: `brute_force:${new Date().toISOString().slice(0, 13)}`,
      message: `Mais de 20 tentativas de login com senha errada nos últimos 15 minutos (último IP: ${ip ?? 'desconhecido'}). Possível tentativa de invasão.`,
    });
  }
}

async function alertIfNewLocation(u: any, meta: Meta) {
  if (u.role === 'vendedor' || !meta.ip) return;
  // histórico de logins da auditoria (o login atual é registrado depois desta verificação)
  const { rows } = await pool.query<{ total: number; same_ip: number }>(
    "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ip = $2)::int AS same_ip FROM audit_log WHERE user_id = $1 AND action = 'auth.login'",
    [u.id, meta.ip],
  );
  if (rows[0].total > 0 && rows[0].same_ip === 0) {
    await upsertAlert({
      type: 'SECURITY_NEW_LOGIN', severity: 'warning', dedupeKey: `new_login:${u.id}:${meta.ip}`,
      message: `Novo acesso à conta "${u.username}" (${u.role}) a partir de um endereço não usado antes (IP ${meta.ip}). Se não foi você, troque a senha e use "Sair de todos os aparelhos".`,
    });
  }
}

// ------------------------------------------------------------------ sessões
export async function getUserById(id: string): Promise<SessionUser | null> {
  const { rows } = await pool.query('SELECT id, username, name, role, bling_seller_id FROM users WHERE id = $1 AND active', [id]);
  return rows[0] ? toSessionUser(rows[0]) : null;
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const { rows } = await pool.query(
    `UPDATE sessions s SET last_seen = now(),
       expires_at = GREATEST(s.expires_at, now() + ($2 || ' hours')::interval / 2)
     FROM users u WHERE s.token_hash = $1 AND u.id = s.user_id AND s.expires_at > now() AND u.active AND NOT u.pending_approval
       AND s.created_at > now() - (CASE WHEN u.role = 'vendedor' THEN $3 ELSE $4 END || ' hours')::interval
     RETURNING u.id, u.username, u.name, u.role, u.bling_seller_id`,
    [sha256(token), String(config.SESSION_TTL_HOURS), String(ABSOLUTE_SESSION_HOURS.vendedor), String(ABSOLUTE_SESSION_HOURS.privileged)],
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
  const { rows } = await pool.query('SELECT password_hash, username, email FROM users WHERE id = $1', [userId]);
  if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) throw new Error('Senha atual incorreta.');
  const policy = validatePasswordPolicy(next, [rows[0].username, rows[0].email].filter(Boolean));
  if (policy) throw new Error(policy);
  await pool.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [userId, await hashPassword(next)]);
}
