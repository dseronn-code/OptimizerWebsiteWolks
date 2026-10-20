import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgres://postgres@localhost:5432/blingstock'),
  // Origem pública do frontend (usada em CORS/redirects). Ex.: https://estoque.suaempresa.com.br
  // No Render, RENDER_EXTERNAL_URL é preenchida automaticamente com o endereço público.
  // No Render/Railway, o endereço público é detectado automaticamente.
  APP_ORIGIN: z
    .string()
    .default(
      process.env.RENDER_EXTERNAL_URL ??
        (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:5173'),
    ),
  // Primeira inicialização com banco vazio: carrega a demonstração e/ou cria o administrador.
  SEED_DEMO_IF_EMPTY: z.string().default('false').transform((v) => v === 'true'),
  BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  // Chave AES-256-GCM para cifrar tokens do Bling: 32 bytes em base64 OU uma frase secreta com 32+ caracteres.
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
  // Provedor de IA: 'auto' usa Anthropic se houver ANTHROPIC_API_KEY, senão um provedor compatível com
  // OpenAI se houver AI_BASE_URL + AI_API_KEY (ex.: Groq, Google Gemini — planos gratuitos), senão o local.
  AI_PROVIDER: z.enum(['auto', 'anthropic', 'openai_compat', 'local']).default('auto'),
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  // Tempo máximo por chamada à IA; acima disso o chat responde pelo interpretador local.
  AI_TIMEOUT_MS: z.coerce.number().default(25000),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),

  // Executa jobs/agendamentos dentro do processo web (simplifica implantação pequena).
  RUN_WORKER_IN_PROCESS: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
});

export const config = schema.parse(process.env);

if (config.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  console.error(
    '\n[CONFIGURAÇÃO] A variável DATABASE_URL não foi definida. Crie um banco PostgreSQL e defina ' +
      'DATABASE_URL (no Railway: DATABASE_URL=${{Postgres.DATABASE_URL}} na aba Variables do serviço do app).\n',
  );
  process.exit(1);
}
export type Config = typeof config;

export const isProduction = config.NODE_ENV === 'production';
export type AiProvider = 'anthropic' | 'openai_compat' | 'local';

export function aiProvider(): AiProvider {
  if (config.AI_PROVIDER !== 'auto') return config.AI_PROVIDER;
  if (config.ANTHROPIC_API_KEY) return 'anthropic';
  if (config.AI_BASE_URL && config.AI_API_KEY && config.AI_MODEL) return 'openai_compat';
  return 'local';
}

export const blingConfigured = Boolean(
  config.BLING_CLIENT_ID && config.BLING_CLIENT_SECRET && config.BLING_REDIRECT_URI,
);
