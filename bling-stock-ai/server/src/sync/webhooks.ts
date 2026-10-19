import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { hmacSha256Hex, safeEqual } from '../lib/crypto.js';
import { enqueue } from './jobs.js';

/**
 * Recepção de webhooks do Bling.
 *
 * O webhook é tratado apenas como AVISO de que um recurso mudou: o sistema registra o evento
 * (idempotente pelo identificador do evento), descarta eventos mais antigos que o estado já
 * aplicado e agenda a consulta do recurso na API — que é a fonte da verdade. Assim a
 * consistência não depende do conteúdo nem da ordem de chegada dos webhooks.
 *
 * Formato esperado (documentação de webhooks do Bling v3): { eventId, date, version, event, companyId, data }
 * com `event` no formato "<recurso>.<ação>" (ex.: "order.updated"). A extração é defensiva.
 */

export interface ParsedEvent {
  eventId: string;
  resource: 'sales_order' | 'product' | 'stock' | 'other';
  action: string;
  resourceId: number | null;
  eventDate: Date;
}

export function verifySignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!config.BLING_CLIENT_SECRET) return false;
  if (!header) return false;
  const received = header.replace(/^sha256=/i, '').trim().toLowerCase();
  const expected = hmacSha256Hex(config.BLING_CLIENT_SECRET, rawBody);
  return safeEqual(received, expected);
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseEvent(body: any): ParsedEvent | null {
  if (!body || typeof body !== 'object') return null;
  const event = String(body.event ?? body.evento ?? '');
  const [rawResource, action = 'unknown'] = event.split('.');
  const data = body.data ?? body.dados ?? {};
  let resource: ParsedEvent['resource'] = 'other';
  let resourceId: number | null = null;
  if (/^(order|pedido)/i.test(rawResource)) {
    resource = 'sales_order';
    resourceId = num(data.id);
  } else if (/^(product|produto)/i.test(rawResource)) {
    resource = 'product';
    resourceId = num(data.id);
  } else if (/^(stock|estoque)/i.test(rawResource)) {
    resource = 'stock';
    resourceId = num(data.produto?.id) ?? num(data.idProduto);
  }
  const date = new Date(body.date ?? body.data_evento ?? Date.now());
  const eventId = String(body.eventId ?? body.id ?? '');
  if (!eventId) return null;
  return { eventId, resource, action, resourceId, eventDate: Number.isNaN(date.getTime()) ? new Date() : date };
}

/** Registra o evento e agenda o processamento. Retorna 'duplicate' para eventos repetidos. */
export async function ingestEvent(body: unknown): Promise<'queued' | 'duplicate' | 'ignored' | 'invalid'> {
  const ev = parseEvent(body);
  if (!ev) return 'invalid';
  const ins = await pool.query(
    `INSERT INTO webhook_events (event_id, resource, action, resource_id, event_date, payload)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING`,
    [ev.eventId, ev.resource, ev.action, ev.resourceId, ev.eventDate, JSON.stringify(body)],
  );
  if (ins.rowCount === 0) return 'duplicate';
  if (ev.resource === 'other' || ev.resourceId === null) {
    await pool.query("UPDATE webhook_events SET status = 'ignored', processed_at = now(), note = 'recurso não utilizado' WHERE event_id = $1", [ev.eventId]);
    return 'ignored';
  }
  await enqueue('process_webhook', { eventId: ev.eventId });
  return 'queued';
}
