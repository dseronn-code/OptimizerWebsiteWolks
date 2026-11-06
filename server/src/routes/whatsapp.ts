import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { hmacSha256Hex, safeEqual } from '../lib/crypto.js';
import { log } from '../lib/log.js';
import { handleIncoming, type IncomingMessage } from '../whatsapp/bot.js';

/**
 * Webhook do WhatsApp (API oficial da Meta).
 * GET  — verificação do endereço no painel da Meta (token de verificação).
 * POST — mensagens recebidas, aceitas só com assinatura válida (X-Hub-Signature-256, chave secreta do app).
 */

// fila por remetente: mensagens da mesma pessoa são respondidas na ordem em que chegaram
const queues = new Map<string, Promise<void>>();

function enqueue(from: string, task: () => Promise<void>) {
  const prev = queues.get(from) ?? Promise.resolve();
  const next = prev.then(task).catch((err) => log('whatsapp: falha ao processar mensagem', err));
  queues.set(from, next);
  void next.finally(() => {
    if (queues.get(from) === next) queues.delete(from);
  });
}

/** Testes: espera todas as mensagens em processamento terminarem. */
export async function waitWhatsAppIdle() {
  while (queues.size) await Promise.all([...queues.values()]);
}

export function verifyMetaSignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
  if (!config.WHATSAPP_APP_SECRET || !rawBody || !header) return false;
  const received = header.replace(/^sha256=/i, '').trim().toLowerCase();
  return safeEqual(received, hmacSha256Hex(config.WHATSAPP_APP_SECRET, rawBody));
}

/** Extrai as mensagens do formato da Meta (entry → changes → value → messages). */
export function parseMessages(body: any): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (change?.field !== 'messages' || !value) continue;
      // só mensagens enviadas ao NOSSO número
      if (config.WHATSAPP_PHONE_NUMBER_ID && value.metadata?.phone_number_id && String(value.metadata.phone_number_id) !== String(config.WHATSAPP_PHONE_NUMBER_ID)) continue;
      for (const m of value.messages ?? []) {
        if (!m?.id || !m?.from) continue;
        const reply = m.interactive?.button_reply ?? m.interactive?.list_reply ?? null;
        out.push({
          id: String(m.id),
          from: String(m.from).replace(/\D/g, ''),
          timestamp: m.timestamp,
          type: String(m.type ?? ''),
          text: m.type === 'text' ? String(m.text?.body ?? '') : m.type === 'button' ? String(m.button?.text ?? '') : undefined,
          replyId: reply?.id ? String(reply.id) : undefined,
          replyTitle: reply?.title ? String(reply.title) : undefined,
        });
      }
    }
  }
  return out;
}

export async function whatsappRoutes(app: FastifyInstance) {
  app.get('/api/webhooks/whatsapp', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (q['hub.mode'] === 'subscribe' && config.WHATSAPP_VERIFY_TOKEN && safeEqual(q['hub.verify_token'] ?? '', config.WHATSAPP_VERIFY_TOKEN)) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send({ error: 'Verificação recusada.' });
  });

  app.post('/api/webhooks/whatsapp', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!verifyMetaSignature(req.rawBody, req.headers['x-hub-signature-256'] as string | undefined)) {
      return reply.code(401).send({ error: 'Assinatura inválida.' });
    }
    // responde já (a Meta reenvia se demorar) e processa em seguida
    for (const m of parseMessages(req.body)) enqueue(m.from, () => handleIncoming(m));
    return reply.send({ ok: true });
  });
}
