import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { answerQuestion } from '../ai/agent.js';
import { audit } from '../audit/audit.js';
import { changePassword, login, logout } from '../auth/authService.js';
import { requireUser, send, SESSION_COOKIE, viewerOf, HttpError } from '../auth/guard.js';
import { aiProvider, config, isProduction } from '../config.js';
import { pool } from '../db/pool.js';
import { checkSale } from '../engine/availability.js';
import { parse } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { searchProducts } from '../stock/productSearch.js';
import { getAvailability } from '../stock/stockService.js';

export async function coreRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ autenticação
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) }), req.body);
    const r = await login(body.username, body.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
    if (!r.ok) {
      await audit({ action: r.reason === 'locked' ? 'auth.locked' : 'auth.failed', details: { username: body.username }, ip: req.ip });
      throw new HttpError(401, r.reason === 'locked' ? 'Usuário temporariamente bloqueado por tentativas inválidas. Tente em 15 minutos.' : 'Usuário ou senha inválidos.');
    }
    await audit({ userId: r.user.id, action: 'auth.login', ip: req.ip });
    reply.setCookie(SESSION_COOKIE, r.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.COOKIE_SECURE ?? isProduction,
      path: '/',
      expires: r.expiresAt,
    });
    return send(reply, { user: r.user });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await logout(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return send(reply, { ok: true });
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = requireUser(req);
    const s = await getSettings();
    return send(reply, { user, appMode: s.appMode });
  });

  app.post('/api/auth/password', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(z.object({ current: z.string(), next: z.string() }), req.body);
    try {
      await changePassword(user.id, body.current, body.next);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    await audit({ userId: user.id, action: 'auth.password_changed', ip: req.ip });
    return send(reply, { ok: true });
  });

  // ------------------------------------------------------------------ status geral
  app.get('/api/status', async (req, reply) => {
    requireUser(req);
    const s = await getSettings();
    const { rows } = await pool.query('SELECT resource, last_success_at, last_attempt_at, last_error, last_error_at FROM sync_state ORDER BY resource');
    const conn = await pool.query('SELECT status, last_refresh_at FROM bling_connection WHERE id = 1');
    return send(reply, {
      appMode: s.appMode,
      aiEngine: aiProvider() === 'local' ? 'local' : 'llm',
      bling: conn.rows[0],
      sync: rows.map((r) => ({ ...r, failing: Boolean(r.last_error_at && (!r.last_success_at || r.last_error_at > r.last_success_at)) })),
      settings: { maxBalanceAgeMinutes: s.engine.maxBalanceAgeMinutes, baseMode: s.engine.baseMode },
    });
  });

  // ------------------------------------------------------------------ produtos e disponibilidade
  app.get('/api/products/search', async (req, reply) => {
    requireUser(req);
    const q = parse(z.object({ q: z.string().max(120).default('') }), req.query);
    return send(reply, { results: await searchProducts(q.q, 12) });
  });

  app.get('/api/products/:id/availability', async (req, reply) => {
    const user = requireUser(req);
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const q = parse(z.object({ refresh: z.enum(['0', '1']).optional(), qty: z.coerce.number().positive().optional() }), req.query);
    const r = await getAvailability(id, { viewer: viewerOf(user), freshness: q.refresh === '1' || q.qty ? 'critical' : 'cached' });
    if (!r) throw new HttpError(404, 'Produto não encontrado.');
    return send(reply, { availability: r, sale: q.qty ? checkSale(r, q.qty) : null });
  });

  app.get('/api/products/:id/orders', async (req, reply) => {
    requireUser(req);
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const { rows } = await pool.query(
      `SELECT o.id, o.number, o.order_date, o.expected_date, s.name AS situation, i.quantity
       FROM sales_order_items i JOIN sales_orders o ON o.id = i.order_id LEFT JOIN situations s ON s.id = o.situation_id
       WHERE i.product_id = $1 AND NOT o.deleted ORDER BY o.order_date DESC NULLS LAST LIMIT 100`,
      [id],
    );
    return send(reply, { orders: rows });
  });

  // ------------------------------------------------------------------ chat
  app.post('/api/chat', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    const body = parse(
      z.object({
        question: z.string().trim().min(1).max(1000),
        history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(6000) })).max(20).default([]),
        lastProductId: z.number().int().positive().nullable().default(null),
      }),
      req.body,
    );
    let result;
    try {
      result = await answerQuestion(body.question, body.history, viewerOf(user), body.lastProductId);
    } catch (err) {
      req.log.error({ err }, 'falha no agente de IA; usando interpretador local');
      const { interpretLocally } = await import('../ai/localInterpreter.js');
      const ctx = { viewer: viewerOf(user), cards: [], lastProductId: body.lastProductId };
      const local = await interpretLocally(body.question, ctx);
      result = { ...local, cards: ctx.cards, engine: 'local' as const, lastProductId: ctx.lastProductId };
    }
    await pool.query('INSERT INTO query_history (user_id, question, answer, tools, engine) VALUES ($1, $2, $3, $4, $5)', [
      user.id, body.question, result.answer, JSON.stringify(result.toolCalls), result.engine,
    ]);
    return send(reply, result);
  });

  app.get('/api/history', async (req, reply) => {
    const user = requireUser(req);
    const q = parse(z.object({ userId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    const target = user.role === 'vendedor' ? user.id : q.userId ?? null;
    const { rows } = await pool.query(
      `SELECT h.id, h.question, h.answer, h.engine, h.created_at, u.name AS user_name FROM query_history h JOIN users u ON u.id = h.user_id
       WHERE ($1::uuid IS NULL OR h.user_id = $1) ORDER BY h.created_at DESC LIMIT $2`,
      [target, q.limit],
    );
    return send(reply, { history: rows });
  });

  app.get('/api/deposits', async (req, reply) => {
    requireUser(req);
    const { rows } = await pool.query('SELECT id, name, is_default, ignore_balance, active, source FROM deposits ORDER BY is_default DESC, name');
    return send(reply, { deposits: rows });
  });
}
