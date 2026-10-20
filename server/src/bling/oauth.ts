import { blingConfigured, config } from '../config.js';
import type { Db } from '../db/pool.js';
import { pool, withTransaction } from '../db/pool.js';
import { decrypt, encrypt, randomToken } from '../lib/crypto.js';
import type { TokenProvider } from './httpClient.js';
import { BlingApiError } from './types.js';

/**
 * OAuth 2.0 (authorization code) do Bling v3.
 *  - autorização: GET  {BLING_OAUTH_BASE_URL}/oauth/authorize?response_type=code&client_id=..&state=..
 *  - token:       POST {BLING_OAUTH_BASE_URL}/oauth/token (Basic client_id:client_secret, form-urlencoded)
 * Tokens ficam cifrados (AES-256-GCM) na tabela bling_connection; nunca vão ao frontend.
 * O refresh token é rotativo: a renovação é serializada com advisory lock para que dois
 * processos não usem o mesmo refresh token simultaneamente.
 */

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

const REFRESH_LOCK = 774411; // chave arbitrária do advisory lock
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

function basicAuth() {
  return Buffer.from(`${config.BLING_CLIENT_ID}:${config.BLING_CLIENT_SECRET}`).toString('base64');
}

export async function createAuthorizationUrl(): Promise<string> {
  if (!blingConfigured) throw new Error('Credenciais do aplicativo Bling não configuradas no servidor (variáveis de ambiente).');
  const state = randomToken(24);
  await pool.query('UPDATE bling_connection SET oauth_state = $1, oauth_state_at = now(), updated_at = now() WHERE id = 1', [state]);
  const url = new URL(`${config.BLING_OAUTH_BASE_URL.replace(/\/+$/, '')}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.BLING_CLIENT_ID!);
  url.searchParams.set('state', state);
  return url.toString();
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${config.BLING_OAUTH_BASE_URL.replace(/\/+$/, '')}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: unknown };
  if (!res.ok || !json.access_token) {
    throw new BlingApiError(`Falha ao obter token do Bling (HTTP ${res.status})`, res.status, res.status >= 500, json.error);
  }
  return json;
}

async function saveTokens(t: TokenResponse, db: Db = pool) {
  const expiresAt = new Date(Date.now() + (t.expires_in ?? 21600) * 1000);
  await db.query(
    `UPDATE bling_connection SET
       access_token_enc = $1,
       refresh_token_enc = COALESCE($2, refresh_token_enc),
       access_expires_at = $3, scope = COALESCE($4, scope),
       status = 'connected', last_refresh_at = now(), last_error = NULL, updated_at = now()
     WHERE id = 1`,
    [encrypt(t.access_token), t.refresh_token ? encrypt(t.refresh_token) : null, expiresAt, t.scope ?? null],
  );
}

export async function handleOAuthCallback(code: string, state: string): Promise<void> {
  const { rows } = await pool.query<{ oauth_state: string | null; oauth_state_at: Date | null }>(
    'SELECT oauth_state, oauth_state_at FROM bling_connection WHERE id = 1',
  );
  const row = rows[0];
  const valid = row?.oauth_state && row.oauth_state === state && row.oauth_state_at && Date.now() - row.oauth_state_at.getTime() < 15 * 60 * 1000;
  if (!valid) throw new Error('Parâmetro state inválido ou expirado. Inicie a conexão novamente.');
  const tokens = await requestToken({ grant_type: 'authorization_code', code });
  await saveTokens(tokens);
  await pool.query("UPDATE bling_connection SET oauth_state = NULL, connected_at = now() WHERE id = 1");
}

export async function disconnect(): Promise<void> {
  await pool.query(
    `UPDATE bling_connection SET access_token_enc = NULL, refresh_token_enc = NULL, access_expires_at = NULL,
       status = 'disconnected', updated_at = now() WHERE id = 1`,
  );
}

async function refreshWithLock(force: boolean): Promise<string> {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [REFRESH_LOCK]);
    const { rows } = await client.query(
      'SELECT access_token_enc, refresh_token_enc, access_expires_at FROM bling_connection WHERE id = 1',
    );
    const row = rows[0];
    // Outro processo pode ter renovado enquanto aguardávamos o lock.
    if (!force && row?.access_token_enc && row.access_expires_at && row.access_expires_at.getTime() - Date.now() > EXPIRY_MARGIN_MS) {
      return decrypt(row.access_token_enc);
    }
    if (!row?.refresh_token_enc) throw new BlingApiError('Bling não conectado (sem refresh token).', 401, false);
    try {
      const tokens = await requestToken({ grant_type: 'refresh_token', refresh_token: decrypt(row.refresh_token_enc) });
      await saveTokens(tokens, client);
      return tokens.access_token;
    } catch (err) {
      await client.query("UPDATE bling_connection SET last_error = $1, status = CASE WHEN $2 THEN 'error' ELSE status END, updated_at = now() WHERE id = 1", [
        (err as Error).message,
        err instanceof BlingApiError && (err.status === 400 || err.status === 401),
      ]);
      throw err;
    }
  });
}

export const dbTokenProvider: TokenProvider = {
  async getAccessToken() {
    const { rows } = await pool.query('SELECT access_token_enc, access_expires_at, status FROM bling_connection WHERE id = 1');
    const row = rows[0];
    if (row?.access_token_enc && row.access_expires_at && row.access_expires_at.getTime() - Date.now() > EXPIRY_MARGIN_MS) {
      return decrypt(row.access_token_enc);
    }
    return refreshWithLock(false);
  },
  forceRefresh() {
    return refreshWithLock(true);
  },
};

export async function connectionStatus() {
  const { rows } = await pool.query(
    'SELECT status, access_expires_at, connected_at, last_refresh_at, last_error, scope FROM bling_connection WHERE id = 1',
  );
  return { configured: blingConfigured, ...rows[0] };
}
