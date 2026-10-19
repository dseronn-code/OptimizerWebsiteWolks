import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgres://postgres@localhost:5432/blingstock'),
  // Origem pública do frontend (usada em CORS/redirects). Ex.: https://estoque.suaempresa.com.br
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  // 32 bytes em base64 — chave AES-256-GCM para cifrar tokens do Bling no banco.
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  // Fuso usado nas respostas em texto do assistente.
  APP_TIMEZONE: z.string().default('America/Sao_Paulo'),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),

  BLING_CLIENT_ID: z.string().optional(),
  BLING_CLIENT_SECRET: z.string().optional(),
  BLING_REDIRECT_URI: z.string().optional(),
  BLING_API_BASE_URL: z.string().default('https://api.bling.com.br/Api/v3'),
  BLING_OAUTH_BASE_URL: z.string().default('https://www.bling.com.br/Api/v3'),
  // Cabeçalho de assinatura dos webhooks (HMAC-SHA256 do corpo com o client secret).
  BLING_WEBHOOK_SIGNATURE_HEADER: z.string().default('x-bling-signature-256'),
  BLING_REQUESTS_PER_SECOND: z.coerce.number().default(3),

  ANTHROPIC_API_KEY: z.string().optional(),
  // Necessário apenas para chaves não vinculadas a um workspace (cabeçalho anthropic-workspace-id).
  ANTHROPIC_WORKSPACE_ID: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),

  // Executa jobs/agendamentos dentro do processo web (simplifica implantação pequena).
  RUN_WORKER_IN_PROCESS: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
});

export const config = schema.parse(process.env);
export type Config = typeof config;

export const isProduction = config.NODE_ENV === 'production';
export const blingConfigured = Boolean(
  config.BLING_CLIENT_ID && config.BLING_CLIENT_SECRET && config.BLING_REDIRECT_URI,
);
