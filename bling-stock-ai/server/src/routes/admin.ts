import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit/audit.js';
import { createUser, hashPassword, revokeUserSessions, validatePasswordPolicy } from '../auth/authService.js';
import { HttpError, requireUser, send } from '../auth/guard.js';
import { connectionStatus, createAuthorizationUrl, disconnect, handleOAuthCallback } from '../bling/oauth.js';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { parse } from '../lib/http.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { enqueue } from '../sync/jobs.js';
import { ingestEvent, verifySignature } from '../sync/webhooks.js';

export async function adminRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ usuários
  app.get('/api/admin/users', async (req, reply) => {
    requireUser(req, ['admin']);
    const { rows } = await pool.query('SELECT id, username, name, role, bling_seller_id, active, locked_until, created_at FROM users ORDER BY name');
    return send(reply, { users: rows });
  });

  app.post('/api/admin/users', async (req, reply) => {
    const admin = requireUser(req, ['admin']);
    const body = parse(
      z.object({ username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/), name: z.string().trim().min(2).max(120), password: z.string().max(200), role: z.enum(['vendedor', 'gestor', 'admin']), blingSellerId: z.number().int().positive().nullable().optional() }),
      req.body,
    );
    try {
      const u = await createUser(body);
      await audit({ userId: admin.id, action: 'user.create', entity: 'user', entityId: u.id, details: { username: u.username, role: u.role }, ip: req.ip });
      return send(reply, { user: u });
    } catch (err) {
      const msg = (err as Error).message;
      throw new HttpError(400, /duplicate|unique/i.test(msg) ? 'Nome de usuário já existe.' : msg);
    }
  });

  app.put('/api/admin/users/:id', async (req, reply) => {
    const admin = requireUser(req, ['admin']);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(120).optional(), role: z.enum(['vendedor', 'gestor', 'admin']).optional(), blingSellerId: z.number().int().positive().nullable().optional(), active: z.boolean().optional(), password: z.string().max(200).optional() }),
      req.body,
    );
    if (id === admin.id && (body.active === false || (body.role && body.role !== 'admin'))) throw new HttpError(400, 'Você não pode desativar ou rebaixar o próprio usuário.');
    if (body.password) {
      const policy = validatePasswordPolicy(body.password);
      if (policy) throw new HttpError(400, policy);
    }
    await pool.query(
      `UPDATE users SET name = COALESCE($2, name), role = COALESCE($3, role),
         bling_seller_id = CASE WHEN $4 THEN $5 ELSE bling_seller_id END, active = COALESCE($6, active),
         password_hash = COALESCE($7, password_hash), failed_logins = CASE WHEN $7 IS NOT NULL THEN 0 ELSE failed_logins END,
         locked_until = CASE WHEN $7 IS NOT NULL THEN NULL ELSE locked_until END, updated_at = now()
       WHERE id = $1`,
      [id, body.name ?? null, body.role ?? null, body.blingSellerId !== undefined, body.blingSellerId ?? null, body.active ?? null, body.password ? await hashPassword(body.password) : null],
    );
    if (body.active === false || body.password || body.role) await revokeUserSessions(id);
    await audit({ userId: admin.id, action: 'user.update', entity: 'user', entityId: id, details: { ...body, password: body.password ? '***' : undefined }, ip: req.ip });
    return send(reply, { ok: true });
  });

  // ------------------------------------------------------------------ configurações
  app.get('/api/admin/settings', async (req, reply) => {
    requireUser(req, ['admin', 'gestor']);
    return send(reply, { settings: await getSettings() });
  });

  const settingsSchema = z.object({
    appMode: z.enum(['demo', 'live']).optional(),
    engine: z.object({
      baseMode: z.enum(['PHYSICAL', 'VIRTUAL']).optional(),
      maxBalanceAgeMinutes: z.number().int().min(1).max(1440).optional(),
      criticalRefreshMinutes: z.number().int().min(0).max(1440).optional(),
      ordersMaxAgeMinutes: z.number().int().min(5).max(1440).optional(),
      expiredReservationPolicy: z.enum(['KEEP_UNTIL_REVIEW', 'AUTO_RELEASE']).optional(),
    }).optional(),
    sync: z.object({ incrementalMinutes: z.number().int().min(2).max(1440).optional(), reconcileMinutes: z.number().int().min(10).max(1440).optional(), initialLookbackDays: z.number().int().min(1).max(730).optional() }).optional(),
    reservations: z.object({ defaultValidityHours: z.number().min(1).max(24 * 60).optional(), maxValidityDays: z.number().int().min(1).max(90).optional(), expiringSoonHours: z.number().min(1).max(240).optional(), autoApproveSellers: z.boolean().optional() }).optional(),
    privacy: z.object({ sellersSeeAllCustomers: z.boolean().optional() }).optional(),
    alerts: z.object({ staleOpportunityDays: z.number().int().min(1).max(90).optional(), committedWithoutPostingDays: z.number().int().min(1).max(90).optional() }).optional(),
  });

  app.put('/api/admin/settings', async (req, reply) => {
    const admin = requireUser(req, ['admin']);
    const body = parse(settingsSchema, req.body);
    const next = await updateSettings(body as never, admin.id);
    await audit({ userId: admin.id, action: 'settings.update', details: body, ip: req.ip });
    return send(reply, { settings: next });
  });

  // ------------------------------------------------------------------ regras de situação
  app.get('/api/admin/situations', async (req, reply) => {
    requireUser(req, ['admin', 'gestor']);
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.inherited_id, hs.name AS inherited_name, s.source, r.category, r.stock_effect, r.virtual_effect, r.label, r.notes, r.updated_at,
              (SELECT COUNT(*)::int FROM sales_orders o WHERE o.situation_id = s.id AND NOT o.deleted) AS orders
       FROM situations s LEFT JOIN situation_rules r ON r.situation_id = s.id LEFT JOIN situations hs ON hs.id = s.inherited_id
       ORDER BY s.name`,
    );
    return send(reply, { situations: rows });
  });

  app.put('/api/admin/situations/:id/rule', async (req, reply) => {
    const admin = requireUser(req, ['admin']);
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const body = parse(
      z.object({
        category: z.enum(['COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY', 'CANCELLED', 'FULFILLED', 'IGNORED']).nullable(),
        stockEffect: z.enum(['NOT_POSTED', 'POSTED', 'UNKNOWN']).optional(),
        virtualEffect: z.enum(['REFLECTED', 'NOT_REFLECTED', 'UNKNOWN']).optional(),
        label: z.string().max(120).optional(),
        notes: z.string().max(500).optional(),
      }),
      req.body,
    );
    if (body.category === null) {
      await pool.query('DELETE FROM situation_rules WHERE situation_id = $1', [id]);
    } else {
      await pool.query(
        `INSERT INTO situation_rules (situation_id, category, stock_effect, virtual_effect, label, notes, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (situation_id) DO UPDATE SET category = EXCLUDED.category, stock_effect = EXCLUDED.stock_effect, virtual_effect = EXCLUDED.virtual_effect,
           label = EXCLUDED.label, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [id, body.category, body.stockEffect ?? 'UNKNOWN', body.virtualEffect ?? 'UNKNOWN', body.label ?? null, body.notes ?? null, admin.id],
      );
    }
    await audit({ userId: admin.id, action: 'situation_rule.update', entity: 'situation', entityId: id, details: body, ip: req.ip });
    await enqueue('alerts_scan', {}, { dedupeKey: 'alerts_scan' });
    return send(reply, { ok: true });
  });

  // ------------------------------------------------------------------ integração Bling
  app.get('/api/admin/bling', async (req, reply) => {
    requireUser(req, ['admin']);
    return send(reply, { connection: await connectionStatus(), redirectUri: config.BLING_REDIRECT_URI ?? null, webhookUrl: `${config.APP_ORIGIN.replace(/\/+$/, '')}/api/webhooks/bling` });
  });

  app.post('/api/admin/bling/connect', async (req, reply) => {
    const admin = requireUser(req, ['admin']);
    try {
      const url = await createAuthorizationUrl();
      await audit({ userId: admin.id, action: 'bling.connect_started', ip: req.ip });
      return send(reply, { url });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.post('/api/admin/bling/disconnect', async (req, reply) => {
    const admin = requireUser(req, ['admin']);
    await disconnect();
    await audit({ userId: admin.id, action: 'bling.disconnect', ip: req.ip });
    return send(reply, { ok: true });
  });

  // Callback do OAuth: chega por redirecionamento do Bling; protegido pelo parâmetro state.
  app.get('/api/bling/callback', async (req, reply) => {
    const q = parse(z.object({ code: z.string().min(1).max(500).optional(), state: z.string().min(1).max(200).optional(), error: z.string().max(200).optional() }), req.query);
    const base = config.APP_ORIGIN.replace(/\/+$/, '');
    if (q.error || !q.code || !q.state) return reply.redirect(`${base}/admin?bling=erro`);
    try {
      await handleOAuthCallback(q.code, q.state);
      await audit({ action: 'bling.connected', ip: req.ip });
      await enqueue('sync_full', { triggeredBy: 'conexao' }, { dedupeKey: 'sync_full' });
      return reply.redirect(`${base}/admin?bling=conectado`);
    } catch (err) {
      req.log.error({ err }, 'falha no callback OAuth do Bling');
      return reply.redirect(`${base}/admin?bling=erro`);
    }
  });

  app.post('/api/admin/sync', async (req, reply) => {
    const user = requireUser(req, ['admin', 'gestor']);
    const body = parse(z.object({ kind: z.enum(['full', 'incremental', 'reconcile', 'alerts']) }), req.body);
    const type = { full: 'sync_full', incremental: 'sync_incremental', reconcile: 'reconcile', alerts: 'alerts_scan' }[body.kind];
    await enqueue(type, { triggeredBy: user.username }, { dedupeKey: type, maxAttempts: 3 });
    await audit({ userId: user.id, action: 'sync.requested', details: body, ip: req.ip });
    return send(reply, { queued: true });
  });

  app.get('/api/admin/sync/runs', async (req, reply) => {
    requireUser(req, ['admin', 'gestor']);
    const runs = await pool.query('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 100');
    const jobs = await pool.query("SELECT id, type, status, attempts, max_attempts, run_at, last_error, created_at, finished_at FROM jobs ORDER BY id DESC LIMIT 50");
    const hooks = await pool.query('SELECT event_id, resource, action, resource_id, event_date, received_at, status, note FROM webhook_events ORDER BY received_at DESC LIMIT 50');
    return send(reply, { runs: runs.rows, jobs: jobs.rows, webhooks: hooks.rows });
  });

  app.get('/api/admin/audit', async (req, reply) => {
    requireUser(req, ['admin']);
    const { rows } = await pool.query(
      'SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT 300',
    );
    return send(reply, { audit: rows });
  });

  // ------------------------------------------------------------------ webhooks do Bling
  app.post('/api/webhooks/bling', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const sig = req.headers[config.BLING_WEBHOOK_SIGNATURE_HEADER.toLowerCase()] as string | undefined;
    if (!req.rawBody || !verifySignature(req.rawBody, sig)) {
      await audit({ action: 'webhook.rejected', details: { reason: 'assinatura inválida' }, ip: req.ip });
      return reply.code(401).send({ error: 'assinatura inválida' });
    }
    const outcome = await ingestEvent(req.body);
    return reply.code(outcome === 'invalid' ? 400 : 200).send({ outcome });
  });
}
