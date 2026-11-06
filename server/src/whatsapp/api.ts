import { config } from '../config.js';
import { log } from '../lib/log.js';

/**
 * Envio de mensagens pela API oficial do WhatsApp (Meta — WhatsApp Business Cloud API).
 * Somente texto e mensagens interativas (botões/listas). Nada aqui altera o Bling.
 */

export interface Button {
  id: string;
  /** até 20 caracteres */
  title: string;
}

export interface ListRow {
  id: string;
  /** até 24 caracteres */
  title: string;
  /** até 72 caracteres */
  description?: string;
}

type Transport = (payload: Record<string, unknown>) => Promise<{ ok: boolean; status: number; body: unknown }>;

let testTransport: Transport | null = null;

/** Testes: captura os envios em vez de chamar a Meta. */
export function setWhatsAppTransportForTests(t: Transport | null) {
  testTransport = t;
}

export function whatsappConfigured(): boolean {
  return Boolean(testTransport || (config.WHATSAPP_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID));
}

async function post(payload: Record<string, unknown>) {
  if (testTransport) return testTransport(payload);
  const url = `${config.WHATSAPP_API_BASE_URL.replace(/\/+$/, '')}/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    signal: AbortSignal.timeout(15000),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* sem corpo */
  }
  return { ok: res.ok, status: res.status, body };
}

export class WhatsAppSendError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

async function send(payload: Record<string, unknown>) {
  if (!whatsappConfigured()) throw new WhatsAppSendError('WhatsApp não configurado.', 0, null);
  const r = await post(payload);
  if (!r.ok) {
    const err = (r.body as { error?: { message?: string; code?: number } } | null)?.error;
    throw new WhatsAppSendError(`Falha ao enviar pelo WhatsApp (${r.status}${err?.code ? `, código ${err.code}` : ''}): ${err?.message ?? 'erro desconhecido'}`, r.status, r.body);
  }
  return r.body;
}

const LIMIT = 4000; // a Meta aceita até 4096 caracteres por mensagem de texto

/** Divide textos longos em partes, quebrando em linhas sempre que possível. */
export function splitText(text: string, limit = LIMIT): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

export async function sendText(to: string, text: string) {
  for (const body of splitText(text)) {
    await send({ recipient_type: 'individual', to, type: 'text', text: { body, preview_url: false } });
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Mensagem com até 3 botões de resposta rápida. */
export async function sendButtons(to: string, text: string, buttons: Button[]) {
  const parts = splitText(text, 1000);
  for (const p of parts.slice(0, -1)) await sendText(to, p);
  await send({
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: parts[parts.length - 1] ?? '​' },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, 20) } })) },
    },
  });
}

/** Mensagem com um menu de até 10 opções. */
export async function sendList(to: string, text: string, buttonText: string, rows: ListRow[], sectionTitle = 'Opções') {
  const parts = splitText(text, 1000);
  for (const p of parts.slice(0, -1)) await sendText(to, p);
  await send({
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: parts[parts.length - 1] ?? '​' },
      action: {
        button: clip(buttonText, 20),
        sections: [{ title: clip(sectionTitle, 24), rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}) })) }],
      },
    },
  });
}

/** Marca a mensagem como lida (os "dois tracinhos azuis") — só para números autorizados. */
export async function markRead(messageId: string) {
  try {
    await send({ status: 'read', message_id: messageId });
  } catch (err) {
    log('whatsapp: falha ao marcar como lida', err);
  }
}

/**
 * Avisos iniciados pelo sistema (ex.: nova solicitação de compra para o gestor).
 * A Meta só aceita texto livre se a pessoa falou com o bot nas últimas 24 h; fora disso é preciso
 * um modelo aprovado. Se WHATSAPP_NOTIFY_TEMPLATE estiver definido, ele é usado como alternativa.
 */
export async function sendNotification(to: string, text: string) {
  try {
    await sendText(to, text);
  } catch (err) {
    const template = process.env.WHATSAPP_NOTIFY_TEMPLATE;
    if (!template) throw err;
    await send({
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: process.env.WHATSAPP_NOTIFY_TEMPLATE_LANG ?? 'pt_BR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: clip(text.replace(/\s*\n+\s*/g, ' · '), 1000) }] }],
      },
    });
  }
}
