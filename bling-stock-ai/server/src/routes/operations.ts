import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit/audit.js';
import { HttpError, requireUser, send, viewerOf } from '../auth/guard.js';
import { pool } from '../db/pool.js';
import { calculateAvailability } from '../engine/availability.js';
import { parse } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import {
  approveReservation,
  changeReservationStatus,
  createReservation,
  linkReservationToOrder,
  listReservations,
  renewReservation,
  reservationHistory,
  ReservationError,
} from '../reservations/reservationService.js';
import { loadEngineInput } from '../stock/repository.js';
import { canSeeCustomer } from '../stock/stockService.js';

const MANAGERS = ['gestor', 'admin'] as const;

function wrap<T>(p: Promise<T>): Promise<T> {
  return p.catch((err) => {
    if (err instanceof ReservationError) throw new HttpError(err.status, err.message);
    throw err;
  });
}

export async function operationsRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ reservas
  app.get('/api/reservations', async (req, reply) => {
    const user = requireUser(req);
    const q = parse(
      z.object({ status: z.string().max(20).optional(), productId: z.coerce.number().optional(), mine: z.enum(['0', '1']).optional(), customer: z.string().max(80).optional(), sellerUserId: z.string().uuid().optional() }),
      req.query,
    );
    const rows = await listReservations({ status: q.status, productId: q.productId, customer: q.customer, sellerUserId: q.mine === '1' ? user.id : q.sellerUserId }, viewerOf(user));
    return send(reply, { reservations: rows });
  });

  app.post('/api/reservations', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(
      z.object({
        productId: z.number().int().positive(),
        depositId: z.number().int().positive().nullable().optional(),
        quantity: z.number().positive(),
        customerName: z.string().trim().min(2).max(120),
        negotiationRef: z.string().max(120).nullable().optional(),
        blingOrderId: z.number().int().positive().nullable().optional(),
        reason: z.string().trim().min(3).max(500),
        validityHours: z.number().positive().max(24 * 60).optional(),
        forceUnconfirmed: z.boolean().optional(),
      }),
      req.body,
    );
    const r = await wrap(createReservation(body, viewerOf(user), req.ip));
    return send(reply, r);
  });

  app.post('/api/reservations/:id/:action', async (req, reply) => {
    const user = requireUser(req);
    const { id, action } = parse(z.object({ id: z.string().uuid(), action: z.enum(['approve', 'reject', 'cancel', 'release', 'renew', 'link']) }), req.params);
    const body = parse(
      z.object({ reason: z.string().max(500).optional(), hours: z.number().positive().max(24 * 60).optional(), blingOrderId: z.number().int().positive().optional(), forceUnconfirmed: z.boolean().optional() }).default({}),
      req.body ?? {},
    );
    const v = viewerOf(user);
    if (action === 'approve') await wrap(approveReservation(id, v, { forceUnconfirmed: body.forceUnconfirmed }, req.ip));
    else if (action === 'renew') await wrap(renewReservation(id, body.hours ?? 48, v, req.ip));
    else if (action === 'link') {
      if (!body.blingOrderId) throw new HttpError(400, 'Informe o pedido do Bling.');
      await wrap(linkReservationToOrder(id, body.blingOrderId, v, req.ip));
    } else await wrap(changeReservationStatus(id, action, v, body.reason ?? null, req.ip));
    return send(reply, { ok: true });
  });

  app.get('/api/reservations/:id/history', async (req, reply) => {
    requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return send(reply, { history: await reservationHistory(id) });
  });

  // ------------------------------------------------------------------ bloqueios operacionais
  app.get('/api/blocks', async (req, reply) => {
    requireUser(req);
    const { rows } = await pool.query(
      `SELECT b.*, p.sku, p.name AS product_name, d.name AS deposit_name, u.name AS created_by_name
       FROM stock_blocks b JOIN products p ON p.id = b.product_id LEFT JOIN deposits d ON d.id = b.deposit_id LEFT JOIN users u ON u.id = b.created_by
       WHERE b.active ORDER BY b.created_at DESC`,
    );
    return send(reply, { blocks: rows });
  });

  app.post('/api/blocks', async (req, reply) => {
    const user = requireUser(req, [...MANAGERS]);
    const body = parse(
      z.object({
        productId: z.number().int().positive(),
        depositId: z.number().int().positive().nullable().optional(),
        quantity: z.number().positive(),
        reasonType: z.enum(['AVARIA', 'CONFERENCIA', 'ENTRADA_NAO_RECEBIDA', 'DECISAO_OPERACIONAL']),
        notes: z.string().max(500).optional(),
      }),
      req.body,
    );
    const { rows } = await pool.query(
      'INSERT INTO stock_blocks (product_id, deposit_id, quantity, reason_type, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [body.productId, body.depositId ?? null, body.quantity, body.reasonType, body.notes ?? null, user.id],
    );
    await audit({ userId: user.id, action: 'block.create', entity: 'stock_block', entityId: rows[0].id, details: body, ip: req.ip });
    return send(reply, { block: rows[0] });
  });

  app.post('/api/blocks/:id/release', async (req, reply) => {
    const user = requireUser(req, [...MANAGERS]);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await pool.query('UPDATE stock_blocks SET active = false, released_at = now(), released_by = $2 WHERE id = $1', [id, user.id]);
    await audit({ userId: user.id, action: 'block.release', entity: 'stock_block', entityId: id, ip: req.ip });
    return send(reply, { ok: true });
  });

  // ------------------------------------------------------------------ pedidos (consulta + controles complementares)
  app.get('/api/orders', async (req, reply) => {
    const user = requireUser(req);
    const q = parse(
      z.object({
        category: z.string().max(30).optional(),
        situationId: z.coerce.number().optional(),
        customer: z.string().max(80).optional(),
        sellerId: z.coerce.number().optional(),
        productId: z.coerce.number().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        openOnly: z.enum(['0', '1']).default('1'),
      }),
      req.query,
    );
    const { rows } = await pool.query(
      `SELECT o.id, o.number, o.order_date, o.expected_date, o.customer_name, o.seller_id, o.situation_id, s.name AS situation,
              COALESCE(r1.category, r2.category, 'UNMAPPED') AS category,
              COALESCE(ov.stock_effect, r1.stock_effect, r2.stock_effect, 'UNKNOWN') AS stock_effect,
              json_agg(json_build_object('itemId', i.id, 'productId', i.product_id, 'sku', COALESCE(p.sku, i.sku), 'name', COALESCE(p.name, i.description), 'quantity', i.quantity)) AS items
       FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN situations s ON s.id = o.situation_id
       LEFT JOIN situation_rules r1 ON r1.situation_id = o.situation_id LEFT JOIN situation_rules r2 ON r2.situation_id = s.inherited_id
       LEFT JOIN order_overrides ov ON ov.order_id = o.id
       WHERE NOT o.deleted
         AND ($1::text IS NULL OR COALESCE(r1.category, r2.category, 'UNMAPPED') = $1)
         AND ($2::bigint IS NULL OR o.situation_id = $2)
         AND ($3::text IS NULL OR o.customer_name ILIKE '%' || $3 || '%')
         AND ($4::bigint IS NULL OR o.seller_id = $4)
         AND ($5::bigint IS NULL OR EXISTS (SELECT 1 FROM sales_order_items x WHERE x.order_id = o.id AND x.product_id = $5))
         AND ($6::date IS NULL OR o.order_date >= $6) AND ($7::date IS NULL OR o.order_date <= $7)
         AND ($8 = '0' OR COALESCE(r1.category, r2.category, 'UNMAPPED') IN ('COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY', 'UNMAPPED'))
       GROUP BY o.id, s.name, r1.category, r2.category, r1.stock_effect, r2.stock_effect, ov.stock_effect
       ORDER BY o.order_date DESC NULLS LAST LIMIT 300`,
      [q.category ?? null, q.situationId ?? null, q.customer ?? null, q.sellerId ?? null, q.productId ?? null, q.from ?? null, q.to ?? null, q.openOnly],
    );
    const settings = await getSettings();
    const v = viewerOf(user);
    return send(reply, {
      orders: rows.map((o) => (canSeeCustomer({ sellerId: o.seller_id, sellerUserId: null }, v, settings) ? o : { ...o, customer_name: 'Cliente de outro vendedor' })),
    });
  });

  app.put('/api/orders/:id/override', async (req, reply) => {
    const user = requireUser(req, [...MANAGERS]);
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const body = parse(z.object({ stockEffect: z.enum(['NOT_POSTED', 'POSTED', 'UNKNOWN']).nullable(), depositId: z.number().int().positive().nullable().optional(), notes: z.string().max(500).optional() }), req.body);
    await pool.query(
      `INSERT INTO order_overrides (order_id, stock_effect, deposit_id, notes, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (order_id) DO UPDATE SET stock_effect = EXCLUDED.stock_effect, deposit_id = EXCLUDED.deposit_id, notes = EXCLUDED.notes,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [id, body.stockEffect, body.depositId ?? null, body.notes ?? null, user.id],
    );
    await audit({ userId: user.id, action: 'order.override', entity: 'sales_order', entityId: id, details: body, ip: req.ip });
    return send(reply, { ok: true });
  });

  app.post('/api/order-items/:id/fulfillments', async (req, reply) => {
    const user = requireUser(req, [...MANAGERS]);
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const body = parse(
      z.object({ quantityDelivered: z.number().min(0).default(0), quantityReleased: z.number().min(0).default(0), deliveredStockPosted: z.boolean().default(false), notes: z.string().max(500).optional() }),
      req.body,
    );
    const item = await pool.query('SELECT quantity FROM sales_order_items WHERE id = $1', [id]);
    if (!item.rows[0]) throw new HttpError(404, 'Item não encontrado.');
    const sum = await pool.query('SELECT COALESCE(SUM(quantity_delivered + quantity_released), 0) AS total FROM item_fulfillments WHERE order_item_id = $1', [id]);
    if (sum.rows[0].total + body.quantityDelivered + body.quantityReleased > item.rows[0].quantity + 1e-9) {
      throw new HttpError(400, 'Quantidade entregue/liberada excede a quantidade do item.');
    }
    const { rows } = await pool.query(
      'INSERT INTO item_fulfillments (order_item_id, quantity_delivered, quantity_released, delivered_stock_posted, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [id, body.quantityDelivered, body.quantityReleased, body.deliveredStockPosted, body.notes ?? null, user.id],
    );
    await audit({ userId: user.id, action: 'order_item.fulfillment', entity: 'sales_order_item', entityId: id, details: body, ip: req.ip });
    return send(reply, { fulfillment: rows[0] });
  });

  // ------------------------------------------------------------------ alertas
  app.get('/api/alerts', async (req, reply) => {
    const user = requireUser(req);
    const q = parse(z.object({ status: z.enum(['open', 'acknowledged', 'resolved', 'active']).default('active'), type: z.string().max(60).optional() }), req.query);
    const { rows } = await pool.query(
      `SELECT a.*, p.sku, p.name AS product_name FROM alerts a LEFT JOIN products p ON p.id = a.product_id
       WHERE ($1 = 'active' AND a.status <> 'resolved' OR a.status = $1) AND ($2::text IS NULL OR a.type = $2)
         AND ($3 OR a.user_id IS NULL OR a.user_id = $4)
       ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.updated_at DESC LIMIT 300`,
      [q.status, q.type ?? null, user.role !== 'vendedor', user.id],
    );
    return send(reply, { alerts: rows });
  });

  app.post('/api/alerts/:id/:action', async (req, reply) => {
    const user = requireUser(req, [...MANAGERS]);
    const { id, action } = parse(z.object({ id: z.string().uuid(), action: z.enum(['ack', 'resolve']) }), req.params);
    await pool.query(
      `UPDATE alerts SET status = $2, updated_at = now(), resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END WHERE id = $1`,
      [id, action === 'ack' ? 'acknowledged' : 'resolved'],
    );
    await audit({ userId: user.id, action: `alert.${action}`, entity: 'alert', entityId: id, ip: req.ip });
    return send(reply, { ok: true });
  });

  // ------------------------------------------------------------------ painel de gestão
  app.get('/api/dashboard', async (req, reply) => {
    requireUser(req, [...MANAGERS]);
    const q = parse(z.object({ depositId: z.coerce.number().optional(), q: z.string().max(80).optional() }), req.query);
    const settings = await getSettings();
    const now = new Date();
    const { rows: products } = await pool.query(
      `SELECT DISTINCT p.id FROM products p JOIN stock_balances b ON b.product_id = p.id
       WHERE p.active AND p.format <> 'V' AND ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%' OR p.sku ILIKE '%' || $1 || '%') LIMIT 1000`,
      [q.q ?? null],
    );
    let confirmed = 0;
    let unconfirmed = 0;
    const atRisk: unknown[] = [];
    const divergent: unknown[] = [];
    for (const { id } of products) {
      const input = await loadEngineInput(id, settings, now);
      if (!input) continue;
      const r = calculateAvailability(input);
      const dep = q.depositId ? r.byDeposit.find((d) => d.depositId === q.depositId) : null;
      if (q.depositId && !dep) continue;
      if (r.status === 'CONFIRMED') confirmed++;
      else unconfirmed++;
      const row = { id, sku: r.product.sku, name: r.product.name, physical: dep ? dep.physical : r.physicalTotal, available: dep ? dep.available : r.available, availableForSale: dep ? dep.availableForSale : r.availableForSale, status: r.status, issues: r.issues.map((i) => i.code) };
      if ((row.available ?? 0) < 0 || r.issues.some((i) => i.code === 'OVERCOMMITTED')) atRisk.push(row);
      if (r.issues.some((i) => ['NEGATIVE_BALANCE', 'OVERCOMMITTED', 'POSSIBLE_DUPLICATE', 'UNMAPPED_SITUATION', 'UNKNOWN_STOCK_EFFECT'].includes(i.code))) divergent.push(row);
    }
    const orderStats = await pool.query(
      `SELECT COALESCE(r1.category, r2.category, 'UNMAPPED') AS category, s.name AS situation, COUNT(DISTINCT o.id)::int AS orders, SUM(i.quantity) AS units
       FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id LEFT JOIN situations s ON s.id = o.situation_id
       LEFT JOIN situation_rules r1 ON r1.situation_id = o.situation_id LEFT JOIN situation_rules r2 ON r2.situation_id = s.inherited_id
       WHERE NOT o.deleted AND COALESCE(r1.category, r2.category, 'UNMAPPED') IN ('COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY', 'UNMAPPED')
       GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    const reservations = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'ACTIVE' AND expires_at > now())::int AS active,
         COUNT(*) FILTER (WHERE status = 'ACTIVE' AND expires_at > now() AND expires_at <= now() + ($1 || ' hours')::interval)::int AS expiring,
         COUNT(*) FILTER (WHERE status = 'EXPIRED' OR (status = 'ACTIVE' AND expires_at <= now()))::int AS expired,
         COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending
       FROM reservations`,
      [String(settings.reservations.expiringSoonHours)],
    );
    const bySeller = await pool.query(
      `SELECT u.name AS seller, SUM(r.quantity) AS units, COUNT(*)::int AS reservations
       FROM reservations r JOIN users u ON u.id = r.seller_user_id WHERE r.status IN ('ACTIVE', 'EXPIRED')
       GROUP BY u.name ORDER BY units DESC`,
    );
    const ordersBySeller = await pool.query(
      `SELECT COALESCE(u.name, 'Vendedor Bling ' || o.seller_id::text, 'Sem vendedor') AS seller, SUM(i.quantity) AS units, COUNT(DISTINCT o.id)::int AS orders
       FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id
       LEFT JOIN users u ON u.bling_seller_id = o.seller_id
       LEFT JOIN situations s ON s.id = o.situation_id
       LEFT JOIN situation_rules r1 ON r1.situation_id = o.situation_id LEFT JOIN situation_rules r2 ON r2.situation_id = s.inherited_id
       WHERE NOT o.deleted AND COALESCE(r1.category, r2.category, 'UNMAPPED') IN ('COMMITTED', 'PRE_ORDER_RESERVED')
       GROUP BY 1 ORDER BY units DESC`,
    );
    const syncFailures = await pool.query(
      "SELECT kind, started_at, error FROM sync_runs WHERE status = 'error' AND started_at > now() - interval '7 days' ORDER BY started_at DESC LIMIT 20",
    );
    const alerts = await pool.query("SELECT severity, COUNT(*)::int AS n FROM alerts WHERE status <> 'resolved' GROUP BY severity");
    const recentReservationChanges = await pool.query(
      `SELECT h.at, h.action, h.from_status, h.to_status, u.name AS user_name, p.sku, r.quantity, r.customer_name
       FROM reservation_history h JOIN reservations r ON r.id = h.reservation_id JOIN products p ON p.id = r.product_id
       LEFT JOIN users u ON u.id = h.user_id ORDER BY h.at DESC LIMIT 20`,
    );
    return send(reply, {
      products: { total: products.length, confirmed, unconfirmed },
      atRisk,
      divergent,
      orders: orderStats.rows,
      reservations: reservations.rows[0],
      committedBySeller: { reservations: bySeller.rows, orders: ordersBySeller.rows },
      syncFailures: syncFailures.rows,
      alerts: alerts.rows,
      recentReservationChanges: recentReservationChanges.rows,
    });
  });
}
