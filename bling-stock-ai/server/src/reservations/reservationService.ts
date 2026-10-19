import type pg from 'pg';
import { audit } from '../audit/audit.js';
import { pool, withTransaction } from '../db/pool.js';
import { upsertAlert } from '../alerts/alertService.js';
import { calculateAvailability } from '../engine/availability.js';
import { getSettings } from '../lib/settings.js';
import { loadEngineInput } from '../stock/repository.js';
import type { Viewer } from '../stock/stockService.js';

/**
 * Módulo complementar de reservas (somente no banco próprio — nada é escrito no Bling).
 *
 * Concorrência: toda ativação de reserva roda em transação com advisory lock por produto,
 * recalculando a disponibilidade dentro do lock. Dois vendedores disputando o último saldo
 * são serializados: o segundo enxerga a reserva do primeiro e é recusado.
 */

export class ReservationError extends Error {
  constructor(message: string, public readonly status = 409) {
    super(message);
  }
}

export interface CreateReservationInput {
  productId: number;
  depositId?: number | null;
  quantity: number;
  customerName: string;
  customerId?: number | null;
  negotiationRef?: string | null;
  blingOrderId?: number | null;
  reason: string;
  validityHours?: number;
  /** Gestor confirma ativação mesmo com disponibilidade não confirmada (registrado em auditoria). */
  forceUnconfirmed?: boolean;
}

const LOCK_NS = 4210;

async function lockProduct(tx: pg.PoolClient, productId: number) {
  await tx.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [LOCK_NS, productId % 2147483647]);
}

async function history(tx: pg.PoolClient, reservationId: string, action: string, from: string | null, to: string | null, userId: string | null, details?: unknown) {
  await tx.query(
    'INSERT INTO reservation_history (reservation_id, action, from_status, to_status, user_id, details) VALUES ($1, $2, $3, $4, $5, $6)',
    [reservationId, action, from, to, userId, details ? JSON.stringify(details) : null],
  );
}

/** Verifica, dentro do lock, se `quantity` cabe na disponibilidade (desconsiderando a própria reserva). */
async function checkCapacity(tx: pg.PoolClient, productId: number, quantity: number, depositId: number | null, excludeReservationId: string | null) {
  const settings = await getSettings(tx);
  const input = await loadEngineInput(productId, settings, new Date(), tx);
  if (!input) throw new ReservationError('Produto não encontrado.', 404);
  if (excludeReservationId) input.reservations = input.reservations.filter((r) => r.id !== excludeReservationId);
  const result = calculateAvailability(input);
  const available =
    depositId !== null
      ? result.byDeposit.find((d) => d.depositId === depositId)?.availableForSale ?? 0
      : result.availableForSale;
  return { result, available, fits: quantity <= available + 1e-9 };
}

export async function createReservation(input: CreateReservationInput, actor: Viewer, ip?: string) {
  if (!(input.quantity > 0)) throw new ReservationError('Quantidade deve ser positiva.', 400);
  const settings = await getSettings();
  const hours = Math.min(input.validityHours ?? settings.reservations.defaultValidityHours, settings.reservations.maxValidityDays * 24);
  const expiresAt = new Date(Date.now() + hours * 3600000);
  const isManager = actor.role !== 'vendedor';
  const wantsActive = isManager || settings.reservations.autoApproveSellers;

  return withTransaction(async (tx) => {
    await lockProduct(tx, input.productId);
    let status: 'PENDING' | 'ACTIVE' = 'PENDING';
    let note: string | null = null;
    if (wantsActive) {
      const cap = await checkCapacity(tx, input.productId, input.quantity, input.depositId ?? null, null);
      const confirmedOk = cap.result.status === 'CONFIRMED' || (isManager && input.forceUnconfirmed);
      if (cap.fits && confirmedOk) status = 'ACTIVE';
      else if (!cap.fits) {
        if (!isManager && settings.reservations.autoApproveSellers) {
          throw new ReservationError(`Saldo insuficiente: disponível para nova venda ${cap.available}, solicitado ${input.quantity}.`);
        }
        if (isManager) throw new ReservationError(`Saldo insuficiente: disponível ${cap.available}, solicitado ${input.quantity}.`);
      } else {
        note = 'Disponibilidade não confirmada — reserva enviada para aprovação do gestor.';
      }
    }
    const { rows } = await tx.query(
      `INSERT INTO reservations (product_id, deposit_id, quantity, customer_name, customer_id, negotiation_ref, bling_order_id,
         seller_user_id, status, reason, expires_at, approved_by, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [
        input.productId, input.depositId ?? null, input.quantity, input.customerName, input.customerId ?? null,
        input.negotiationRef ?? null, input.blingOrderId ?? null, actor.id, status, input.reason, expiresAt,
        status === 'ACTIVE' ? actor.id : null, status === 'ACTIVE' ? new Date() : null,
      ],
    );
    const r = rows[0];
    await history(tx, r.id, 'create', null, status, actor.id, { quantity: input.quantity, forceUnconfirmed: Boolean(input.forceUnconfirmed) });
    await audit({ userId: actor.id, action: 'reservation.create', entity: 'reservation', entityId: r.id, details: { status, quantity: input.quantity, productId: input.productId }, ip }, tx);
    return { reservation: r, note };
  });
}

async function loadForUpdate(tx: pg.PoolClient, id: string) {
  const { rows } = await tx.query('SELECT * FROM reservations WHERE id = $1', [id]);
  if (!rows[0]) throw new ReservationError('Reserva não encontrada.', 404);
  await lockProduct(tx, rows[0].product_id);
  const again = await tx.query('SELECT * FROM reservations WHERE id = $1 FOR UPDATE', [id]);
  return again.rows[0];
}

export async function approveReservation(id: string, actor: Viewer, opts: { forceUnconfirmed?: boolean } = {}, ip?: string) {
  if (actor.role === 'vendedor') throw new ReservationError('Apenas gestores aprovam reservas.', 403);
  return withTransaction(async (tx) => {
    const r = await loadForUpdate(tx, id);
    if (r.status !== 'PENDING') throw new ReservationError(`Reserva está ${r.status}, não pode ser aprovada.`);
    const cap = await checkCapacity(tx, r.product_id, r.quantity, r.deposit_id, r.id);
    if (!cap.fits) throw new ReservationError(`Saldo insuficiente para aprovar: disponível ${cap.available}, reserva ${r.quantity}.`);
    if (cap.result.status !== 'CONFIRMED' && !opts.forceUnconfirmed) {
      throw new ReservationError('Disponibilidade não confirmada. Revise os avisos ou aprove explicitamente assim mesmo.', 412);
    }
    await tx.query("UPDATE reservations SET status = 'ACTIVE', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1", [id, actor.id]);
    await history(tx, id, 'approve', 'PENDING', 'ACTIVE', actor.id, { forceUnconfirmed: Boolean(opts.forceUnconfirmed) });
    await audit({ userId: actor.id, action: 'reservation.approve', entity: 'reservation', entityId: id, ip }, tx);
  });
}

export async function changeReservationStatus(
  id: string,
  action: 'reject' | 'cancel' | 'release',
  actor: Viewer,
  reason: string | null,
  ip?: string,
) {
  return withTransaction(async (tx) => {
    const r = await loadForUpdate(tx, id);
    const own = r.seller_user_id === actor.id;
    const manager = actor.role !== 'vendedor';
    const transitions: Record<typeof action, { from: string[]; to: string; allowed: boolean }> = {
      reject: { from: ['PENDING'], to: 'REJECTED', allowed: manager },
      cancel: { from: ['PENDING', 'ACTIVE', 'EXPIRED'], to: 'CANCELLED', allowed: manager || own },
      release: { from: ['ACTIVE', 'EXPIRED'], to: 'RELEASED', allowed: manager },
    };
    const t = transitions[action];
    if (!t.allowed) throw new ReservationError('Sem permissão para esta operação.', 403);
    if (!t.from.includes(r.status)) throw new ReservationError(`Reserva está ${r.status}; operação não permitida.`);
    await tx.query('UPDATE reservations SET status = $2, updated_at = now() WHERE id = $1', [id, t.to]);
    await history(tx, id, action, r.status, t.to, actor.id, reason ? { reason } : undefined);
    await audit({ userId: actor.id, action: `reservation.${action}`, entity: 'reservation', entityId: id, details: { reason }, ip }, tx);
  });
}

export async function renewReservation(id: string, hours: number, actor: Viewer, ip?: string) {
  const settings = await getSettings();
  const h = Math.min(hours, settings.reservations.maxValidityDays * 24);
  return withTransaction(async (tx) => {
    const r = await loadForUpdate(tx, id);
    const own = r.seller_user_id === actor.id;
    if (!(own || actor.role !== 'vendedor')) throw new ReservationError('Sem permissão.', 403);
    if (!['ACTIVE', 'EXPIRED'].includes(r.status)) throw new ReservationError(`Reserva está ${r.status}; não pode ser renovada.`);
    // Vendedor só renova reserva ainda ativa; reserva vencida exige gestor.
    if (r.status === 'EXPIRED' && actor.role === 'vendedor') throw new ReservationError('Reserva vencida: solicite a renovação ao gestor.', 403);
    const cap = await checkCapacity(tx, r.product_id, r.quantity, r.deposit_id, r.id);
    if (!cap.fits) throw new ReservationError(`Saldo insuficiente para renovar: disponível ${cap.available}.`);
    const expiresAt = new Date(Date.now() + h * 3600000);
    await tx.query("UPDATE reservations SET status = 'ACTIVE', expires_at = $2, updated_at = now() WHERE id = $1", [id, expiresAt]);
    await history(tx, id, 'renew', r.status, 'ACTIVE', actor.id, { expiresAt });
    await audit({ userId: actor.id, action: 'reservation.renew', entity: 'reservation', entityId: id, ip }, tx);
  });
}

/** Vincula a reserva a um pedido do Bling. A partir daí o pedido é a fonte do compromisso. */
export async function linkReservationToOrder(id: string, blingOrderId: number, actor: Viewer, ip?: string) {
  return withTransaction(async (tx) => {
    const r = await loadForUpdate(tx, id);
    if (!(r.seller_user_id === actor.id || actor.role !== 'vendedor')) throw new ReservationError('Sem permissão.', 403);
    if (!['PENDING', 'ACTIVE', 'EXPIRED'].includes(r.status)) throw new ReservationError(`Reserva está ${r.status}.`);
    await tx.query('UPDATE reservations SET bling_order_id = $2, updated_at = now() WHERE id = $1', [id, blingOrderId]);
    await history(tx, id, 'link_order', r.status, r.status, actor.id, { blingOrderId });
    await audit({ userId: actor.id, action: 'reservation.link_order', entity: 'reservation', entityId: id, details: { blingOrderId }, ip }, tx);
  });
}

/**
 * Rotina periódica:
 *  - reservas ativas vencidas → EXPIRED (com alerta ao vendedor);
 *  - reservas vinculadas a pedido do Bling já sincronizado com o produto → CONVERTED.
 */
export async function expireReservations(): Promise<{ expired: number; converted: number }> {
  const expired = await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `UPDATE reservations SET status = 'EXPIRED', updated_at = now()
       WHERE status = 'ACTIVE' AND expires_at <= now() RETURNING id, seller_user_id, quantity, customer_name, product_id`,
    );
    for (const r of rows) {
      await history(tx, r.id, 'expire', 'ACTIVE', 'EXPIRED', null);
      await upsertAlert({
        type: 'RESERVATION_EXPIRED', severity: 'warning', dedupeKey: `reservation_expired:${r.id}`, reservationId: r.id,
        productId: r.product_id, userId: r.seller_user_id,
        message: `Reserva de ${r.quantity} unidade(s) para ${r.customer_name ?? 'cliente'} venceu — renove ou libere.`,
      }, tx);
    }
    return rows.length;
  });
  const converted = await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `UPDATE reservations r SET status = 'CONVERTED', updated_at = now()
       WHERE r.status IN ('ACTIVE', 'EXPIRED', 'PENDING') AND r.bling_order_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id
           LEFT JOIN situations s ON s.id = o.situation_id
           LEFT JOIN situation_rules r1 ON r1.situation_id = o.situation_id
           LEFT JOIN situation_rules r2 ON r2.situation_id = s.inherited_id
           WHERE o.id = r.bling_order_id AND NOT o.deleted AND i.product_id = r.product_id
             AND COALESCE(r1.category, r2.category, 'UNMAPPED') IN ('COMMITTED', 'PRE_ORDER_RESERVED', 'FULFILLED', 'UNMAPPED'))
       RETURNING r.id`,
    );
    for (const r of rows) await history(tx, r.id, 'convert', null, 'CONVERTED', null, { note: 'pedido do Bling assumiu o compromisso' });
    return rows.length;
  });
  return { expired, converted };
}

export async function listReservations(filters: { status?: string; productId?: number; sellerUserId?: string; customer?: string }, viewer: Viewer) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    where.push(`r.status = $${params.length}`);
  }
  if (filters.productId) {
    params.push(filters.productId);
    where.push(`r.product_id = $${params.length}`);
  }
  if (filters.sellerUserId) {
    params.push(filters.sellerUserId);
    where.push(`r.seller_user_id = $${params.length}`);
  }
  if (filters.customer) {
    params.push(`%${filters.customer}%`);
    where.push(`r.customer_name ILIKE $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT r.*, p.sku, p.name AS product_name, u.name AS seller_name, d.name AS deposit_name
     FROM reservations r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.seller_user_id
     LEFT JOIN deposits d ON d.id = r.deposit_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC LIMIT 500`,
    params,
  );
  const settings = await getSettings();
  return rows.map((r) =>
    viewer.role === 'vendedor' && !settings.privacy.sellersSeeAllCustomers && r.seller_user_id !== viewer.id
      ? { ...r, customer_name: 'Cliente de outro vendedor', negotiation_ref: null, reason: '—' }
      : r,
  );
}

export async function reservationHistory(id: string) {
  const { rows } = await pool.query(
    `SELECT h.*, u.name AS user_name FROM reservation_history h LEFT JOIN users u ON u.id = h.user_id
     WHERE h.reservation_id = $1 ORDER BY h.at`,
    [id],
  );
  return rows;
}
