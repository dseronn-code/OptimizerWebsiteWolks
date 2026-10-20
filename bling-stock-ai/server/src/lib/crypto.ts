import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config, isProduction } from '../config.js';

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  if (config.TOKEN_ENCRYPTION_KEY) {
    const raw = config.TOKEN_ENCRYPTION_KEY.trim();
    const k = Buffer.from(raw, 'base64');
    if (k.length === 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(raw)) cachedKey = k;
    // Frase secreta longa (mais fácil de digitar em painéis de hospedagem): deriva 32 bytes.
    else if (raw.length >= 32) cachedKey = createHash('sha256').update(`bling-stock-ai:${raw}`).digest();
    else throw new Error('TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64 ou ser uma frase com pelo menos 32 caracteres');
  } else {
    if (isProduction) throw new Error('TOKEN_ENCRYPTION_KEY é obrigatório em produção');
    // Desenvolvimento/demonstração: chave derivada fixa. Nunca usar com dados reais.
    cachedKey = createHash('sha256').update('bling-stock-ai-dev-only-key').digest();
  }
  return cachedKey;
}

/** AES-256-GCM. Formato: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(payload: string): string {
  const [v, iv, tag, ct] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('formato de segredo inválido');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function hmacSha256Hex(secret: string, body: Buffer | string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
