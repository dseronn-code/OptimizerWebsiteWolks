import { upsertAlert } from '../alerts/alertService.js';
import { audit } from '../audit/audit.js';
import { pool } from '../db/pool.js';
import type { Viewer } from '../stock/stockService.js';
import { notifyUsers } from '../whatsapp/notify.js';

/**
 * Solicitações de compra: quando falta produto, o vendedor pede e o gestor acompanha.
 * São registros internos do sistema — nada é lançado no Bling.
 */

export type PurchaseStatus = 'OPEN' | 'ORDERED' | 'RECEIVED' | 'REJECTED' | 'CANCELLED';

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  OPEN: 'Aberta',
  ORDERED: 'Comprado',
  RECEIVED: 'Recebido',
  REJECTED: 'Recusada',
  CANCELLED: 'Cancelada',
};

export class PurchaseError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

export interface CreatePurchaseInput {
  productId?: number | null;
  /** texto livre quando o produto não está no catálogo */
  productText?: string | null;
  quantity: number;
  customerName?: string | null;
  notes?: string | null;
}

function fmtQty(n: number) {
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

export async function createPurchaseRequest(input: CreatePurchaseInput, actor: Viewer & { name?: string }, source: 'web' | 'whatsapp', ip?: string) {
  if (!(input.quantity > 0)) throw new PurchaseError('Quantidade deve ser maior que zero.');
  let productText = input.productText?.trim() || null;
  let productId: number | null = input.productId ?? null;
  if (productId) {
    const { rows } = await pool.query('SELECT id, sku, name FROM products WHERE id = $1', [productId]);
    if (!rows[0]) throw new PurchaseError('Produto não encontrado.', 404);
    productText = `${rows[0].sku ? `${rows[0].sku} — ` : ''}${rows[0].name}`;
  }
  if (!productText || productText.length < 2) throw new PurchaseError('Informe o produto.');

  const { rows } = await pool.query(
    `INSERT INTO purchase_requests (product_id, product_text, quantity, customer_name, notes, requested_by, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [productId, productText.slice(0, 300), input.quantity, input.customerName?.trim() || null, input.notes?.trim() || null, actor.id, source],
  );
  const pr = rows[0];
  const { rows: who } = await pool.query('SELECT name FROM users WHERE id = $1', [actor.id]);
  const seller = who[0]?.name ?? 'Vendedor';
  // alerta só para gestores (user_id nulo + tipo fora da lista que vendedores enxergam)
  await upsertAlert({
    type: 'PURCHASE_REQUEST',
    severity: 'warning',
    dedupeKey: `purchase_request:${pr.id}`,
    productId,
    message: `Solicitação de compra #${pr.number}: ${fmtQty(pr.quantity)} × ${productText} — pedida por ${seller}.`,
  });
  await audit({ userId: actor.id, action: 'purchase.create', entity: 'purchase_request', entityId: pr.id, details: { quantity: input.quantity, productId, source }, ip });

  const { rows: managers } = await pool.query("SELECT id FROM users WHERE active AND role IN ('gestor', 'admin') AND whatsapp_phone IS NOT NULL");
  await notifyUsers(
    managers.map((m) => m.id),
    `🛒 *Nova solicitação de compra #${pr.number}*\n${fmtQty(pr.quantity)} × ${productText}\nPedida por: ${seller}${pr.notes ? `\nObs.: ${pr.notes}` : ''}\n\nPara atualizar, responda: *compra ${pr.number}*`,
  );
  return pr;
}

/** Vendedor vê só as próprias solicitações (elas citam clientes); gestores veem todas. */
export async function listPurchaseRequests(viewer: Viewer, filters: { status?: string } = {}) {
  const own = viewer.role === 'vendedor';
  const { rows } = await pool.query(
    `SELECT pr.*, u.name AS requested_by_name, h.name AS handled_by_name, p.sku
     FROM purchase_requests pr JOIN users u ON u.id = pr.requested_by
     LEFT JOIN users h ON h.id = pr.handled_by LEFT JOIN products p ON p.id = pr.product_id
     WHERE ($1::text IS NULL OR pr.status = $1) AND ($2::uuid IS NULL OR pr.requested_by = $2)
     ORDER BY CASE pr.status WHEN 'OPEN' THEN 0 WHEN 'ORDERED' THEN 1 ELSE 2 END, pr.created_at DESC LIMIT 300`,
    [filters.status ?? null, own ? viewer.id : null],
  );
  return rows;
}

export async function getPurchaseRequest(ref: { id?: string; number?: number }, viewer: Viewer) {
  const { rows } = await pool.query(
    `SELECT pr.*, u.name AS requested_by_name FROM purchase_requests pr JOIN users u ON u.id = pr.requested_by
     WHERE ($1::uuid IS NOT NULL AND pr.id = $1) OR ($2::int IS NOT NULL AND pr.number = $2)`,
    [ref.id ?? null, ref.number ?? null],
  );
  const pr = rows[0];
  if (!pr || (viewer.role === 'vendedor' && pr.requested_by !== viewer.id)) throw new PurchaseError('Solicitação não encontrada.', 404);
  return pr;
}

/** Gestor: Comprado / Recebido / Recusada. Quem pediu: pode cancelar enquanto estiver aberta. */
export async function updatePurchaseRequest(id: string, status: PurchaseStatus, actor: Viewer, managerNote?: string | null, ip?: string) {
  const pr = await getPurchaseRequest({ id }, actor);
  const manager = actor.role !== 'vendedor';
  if (status === 'CANCELLED') {
    if (pr.requested_by !== actor.id && !manager) throw new PurchaseError('Sem permissão.', 403);
    if (pr.status !== 'OPEN') throw new PurchaseError('Só é possível cancelar uma solicitação ainda aberta.');
  } else {
    if (!manager) throw new PurchaseError('Apenas gestores atualizam solicitações de compra.', 403);
    if (pr.status === 'CANCELLED' || pr.status === 'REJECTED' || pr.status === 'RECEIVED') {
      throw new PurchaseError(`Esta solicitação já está encerrada (${PURCHASE_STATUS_LABEL[pr.status as PurchaseStatus]}).`);
    }
  }
  const { rows } = await pool.query(
    `UPDATE purchase_requests SET status = $2, manager_note = COALESCE($3, manager_note), handled_by = $4, handled_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, status, managerNote?.trim() || null, actor.id],
  );
  const updated = rows[0];
  if (status !== 'OPEN') {
    await pool.query("UPDATE alerts SET status = 'resolved', resolved_at = now(), updated_at = now() WHERE dedupe_key = $1 AND status <> 'resolved'", [`purchase_request:${id}`]);
  }
  await audit({ userId: actor.id, action: 'purchase.update', entity: 'purchase_request', entityId: id, details: { status }, ip });
  if (pr.requested_by !== actor.id) {
    const emoji = status === 'RECEIVED' ? '📦' : status === 'ORDERED' ? '🛒' : status === 'REJECTED' ? '❌' : 'ℹ️';
    await notifyUsers(
      [pr.requested_by],
      `${emoji} Sua solicitação de compra *#${pr.number}* (${fmtQty(pr.quantity)} × ${pr.product_text}) foi marcada como *${PURCHASE_STATUS_LABEL[status]}*.${updated.manager_note ? `\nObs. do gestor: ${updated.manager_note}` : ''}`,
    );
  }
  return updated;
}
