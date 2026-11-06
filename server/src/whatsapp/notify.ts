import { pool } from '../db/pool.js';
import { log } from '../lib/log.js';
import { sendNotification, whatsappConfigured } from './api.js';

/**
 * Avisa usuários do sistema pelo WhatsApp (somente quem tem número cadastrado e está ativo).
 * Falhas não interrompem a operação principal: o aviso também fica registrado em Alertas no site.
 */
export async function notifyUsers(userIds: string[], text: string) {
  if (!whatsappConfigured() || userIds.length === 0) return;
  const { rows } = await pool.query<{ whatsapp_phone: string }>(
    'SELECT whatsapp_phone FROM users WHERE id = ANY($1::uuid[]) AND active AND NOT pending_approval AND whatsapp_phone IS NOT NULL',
    [userIds],
  );
  for (const r of rows) {
    try {
      await sendNotification(r.whatsapp_phone, text);
    } catch (err) {
      log('whatsapp: aviso não entregue', err);
    }
  }
}
