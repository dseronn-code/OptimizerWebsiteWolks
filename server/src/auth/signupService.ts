import { randomInt } from 'node:crypto';
import { audit } from '../audit/audit.js';
import { upsertAlert } from '../alerts/alertService.js';
import { pool, withTransaction } from '../db/pool.js';
import { safeEqual, sha256 } from '../lib/crypto.js';
import { emailConfigured, sendEmail, verificationEmail } from '../lib/email.js';
import { getSettings } from '../lib/settings.js';
import { hashPassword, validatePasswordPolicy } from './authService.js';

/**
 * Cadastro em duas etapas:
 *  1. dados + e-mail → código de 6 dígitos enviado por e-mail (vale 15 min, 5 tentativas);
 *  2. código correto → conta criada como "vendedor"; se a aprovação estiver ligada, fica
 *     inativa até um administrador aprovar.
 * A senha nunca é guardada em texto: a etapa 1 já armazena apenas o hash.
 */

export class SignupError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

const CODE_TTL_MIN = 15;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_S = 60;
const MAX_SENDS_PER_HOUR = 5;

function hashCode(verificationId: string, code: string) {
  return sha256(`${verificationId}:${code}`);
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function signupStatus() {
  const s = await getSettings();
  return { enabled: s.signup.enabled && emailConfigured(), requireApproval: s.signup.requireApproval, allowedDomains: s.signup.allowedDomains };
}

export async function startSignup(input: { name: string; email: string; password: string }, ip: string | null) {
  const s = await getSettings();
  if (!s.signup.enabled) throw new SignupError('O cadastro de novas contas está desativado. Peça acesso ao administrador.', 403);
  if (!emailConfigured()) throw new SignupError('O envio de e-mails ainda não foi configurado. Peça acesso ao administrador.', 503);

  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (name.length < 2) throw new SignupError('Informe seu nome.');
  if (!EMAIL_RE.test(email)) throw new SignupError('E-mail inválido.');
  const domain = email.split('@')[1];
  const allowed = s.signup.allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (allowed.length && !allowed.includes(domain)) {
    throw new SignupError(`Use seu e-mail da empresa (${allowed.map((d) => `@${d}`).join(', ')}).`);
  }
  const policy = validatePasswordPolicy(input.password);
  if (policy) throw new SignupError(policy);

  const exists = await pool.query('SELECT 1 FROM users WHERE lower(email) = $1 OR username = $1', [email]);
  if (exists.rowCount) throw new SignupError('Já existe uma conta com este e-mail. Use "Entrar" ou peça ao administrador para redefinir a senha.', 409);

  const recent = await pool.query<{ n: number }>(
    "SELECT COALESCE(SUM(sent_count), 0)::int AS n FROM email_verifications WHERE (lower(email) = $1 OR ip = $2) AND created_at > now() - interval '1 hour'",
    [email, ip],
  );
  if (recent.rows[0].n >= MAX_SENDS_PER_HOUR) throw new SignupError('Muitas tentativas. Aguarde uma hora e tente novamente.', 429);

  const code = newCode();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO email_verifications (email, code_hash, payload, expires_at, ip)
     VALUES ($1, 'pendente', $2, now() + ($3 || ' minutes')::interval, $4) RETURNING id`,
    [email, JSON.stringify({ name, passwordHash: await hashPassword(input.password) }), String(CODE_TTL_MIN), ip],
  );
  const id = rows[0].id;
  await pool.query('UPDATE email_verifications SET code_hash = $2 WHERE id = $1', [id, hashCode(id, code)]);
  try {
    await sendEmail({ to: email, ...verificationEmail(name, code, CODE_TTL_MIN) });
  } catch (err) {
    await pool.query('DELETE FROM email_verifications WHERE id = $1', [id]);
    throw new SignupError(`Não foi possível enviar o e-mail agora. Tente novamente em instantes. (${(err as Error).message})`, 502);
  }
  await audit({ action: 'signup.code_sent', details: { email }, ip });
  return { verificationId: id, email, expiresInMinutes: CODE_TTL_MIN };
}

export async function resendCode(verificationId: string, ip: string | null) {
  const { rows } = await pool.query('SELECT * FROM email_verifications WHERE id = $1', [verificationId]);
  const v = rows[0];
  if (!v || v.consumed_at) throw new SignupError('Cadastro não encontrado. Comece novamente.', 404);
  const wait = RESEND_COOLDOWN_S - (Date.now() - v.last_sent_at.getTime()) / 1000;
  if (wait > 0) throw new SignupError(`Aguarde ${Math.ceil(wait)} segundos para reenviar.`, 429);
  if (v.sent_count >= MAX_SENDS_PER_HOUR) throw new SignupError('Limite de reenvios atingido. Comece o cadastro novamente mais tarde.', 429);
  const code = newCode();
  await pool.query(
    `UPDATE email_verifications SET code_hash = $2, attempts = 0, sent_count = sent_count + 1, last_sent_at = now(),
       expires_at = now() + ($3 || ' minutes')::interval WHERE id = $1`,
    [verificationId, hashCode(verificationId, code), String(CODE_TTL_MIN)],
  );
  await sendEmail({ to: v.email, ...verificationEmail(v.payload.name, code, CODE_TTL_MIN) }).catch((err) => {
    throw new SignupError(`Não foi possível reenviar o e-mail: ${(err as Error).message}`, 502);
  });
  await audit({ action: 'signup.code_resent', details: { email: v.email }, ip });
  return { ok: true };
}

export type VerifyResult = { status: 'active'; userId: string; username: string } | { status: 'pending_approval'; userId: string };

export async function verifySignup(verificationId: string, code: string, ip: string | null): Promise<VerifyResult> {
  const settings = await getSettings();
  return withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT * FROM email_verifications WHERE id = $1 FOR UPDATE', [verificationId]);
    const v = rows[0];
    if (!v || v.consumed_at) throw new SignupError('Cadastro não encontrado ou já concluído. Comece novamente.', 404);
    if (v.expires_at < new Date()) throw new SignupError('O código expirou. Toque em "Reenviar código".', 410);
    if (v.attempts >= MAX_ATTEMPTS) throw new SignupError('Muitas tentativas erradas. Toque em "Reenviar código" para receber outro.', 429);
    const ok = /^\d{6}$/.test(code.trim()) && safeEqual(hashCode(verificationId, code.trim()), v.code_hash);
    if (!ok) {
      await tx.query('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1', [verificationId]);
      // o COMMIT da transação grava a tentativa mesmo com o erro: usamos retorno especial
      return { status: 'wrong', left: MAX_ATTEMPTS - v.attempts - 1 } as never;
    }
    const exists = await tx.query('SELECT 1 FROM users WHERE lower(email) = $1 OR username = $1', [v.email]);
    if (exists.rowCount) throw new SignupError('Já existe uma conta com este e-mail.', 409);
    const pending = settings.signup.requireApproval;
    const { rows: created } = await tx.query(
      `INSERT INTO users (username, name, password_hash, role, email, email_verified_at, active, pending_approval)
       VALUES ($1, $2, $3, 'vendedor', $1, now(), $4, $5) RETURNING id`,
      [v.email, v.payload.name, v.payload.passwordHash, !pending, pending],
    );
    await tx.query('UPDATE email_verifications SET consumed_at = now() WHERE id = $1', [verificationId]);
    const userId = created[0].id;
    await audit({ userId, action: 'signup.completed', details: { email: v.email, pendingApproval: pending }, ip }, tx);
    if (pending) {
      await upsertAlert(
        {
          type: 'SIGNUP_PENDING',
          severity: 'info',
          dedupeKey: `signup_pending:${userId}`,
          message: `${v.payload.name} (${v.email}) criou uma conta e aguarda aprovação em Administração › Usuários.`,
        },
        tx,
      );
      return { status: 'pending_approval', userId };
    }
    return { status: 'active', userId, username: v.email };
  }).then((r: any) => {
    if (r?.status === 'wrong') {
      throw new SignupError(r.left > 0 ? `Código incorreto. Restam ${r.left} tentativa(s).` : 'Código incorreto. Toque em "Reenviar código" para receber outro.', 400);
    }
    return r as VerifyResult;
  });
}
