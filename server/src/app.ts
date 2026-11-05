import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessionUser } from './auth/authService.js';
import { HttpError, SESSION_COOKIE } from './auth/guard.js';
import { isProduction } from './config.js';
import { adminRoutes } from './routes/admin.js';
import { coreRoutes } from './routes/core.js';
import { operationsRoutes } from './routes/operations.js';
import { stockRoutes } from './routes/stock.js';

/** Cabeçalho exigido em requisições que alteram estado (defesa adicional contra CSRF). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'bling-stock-ai';
const CSRF_EXEMPT = new Set(['/api/webhooks/bling']);

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  // Guarda o corpo bruto (necessário para validar a assinatura HMAC dos webhooks).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, {});
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      done(new HttpError(400, 'JSON inválido'), undefined);
    }
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) =>
      Object.assign(new Error(`Muitas solicitações em pouco tempo. Aguarde ${ctx.after.replace('minute', 'minuto').replace('seconds', 'segundos')} e tente novamente.`), { statusCode: ctx.statusCode }),
  });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    req.user = await getSessionUser(req.cookies[SESSION_COOKIE]);
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const pathname = req.url.split('?')[0];
    if (mutating && !CSRF_EXEMPT.has(pathname) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new HttpError(403, 'Requisição recusada (cabeçalho de proteção ausente).');
    }
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    const status = (err as HttpError).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'erro interno');
    // erros do próprio framework (JSON malformado, corpo grande demais…) vêm em inglês: traduz
    const code = (err as FastifyError).code ?? '';
    const message =
      status >= 500 && isProduction ? 'Erro interno. Tente novamente.'
      : code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'Os dados enviados são grandes demais.'
      : code.startsWith('FST_ERR_CTP') || code === 'FST_ERR_VALIDATION' ? 'Requisição inválida.'
      : err.message;
    reply.code(status).send({ error: message });
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(coreRoutes);
  await app.register(operationsRoutes);
  await app.register(stockRoutes);
  await app.register(adminRoutes);

  // Em produção, serve o frontend compilado (web/dist) com fallback de SPA.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Rota não encontrada' });
      // arquivo estático inexistente (ex.: versão antiga em cache pedindo um .js que não existe mais):
      // responde 404 em vez do index.html, que o navegador rejeitaria como script
      if (/\.[a-z0-9]{1,8}(\?.*)?$/i.test(req.url)) return reply.code(404).send('Não encontrado');
      return reply.sendFile('index.html');
    });
  }
  return app;
}
