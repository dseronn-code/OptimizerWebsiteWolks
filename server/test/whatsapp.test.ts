import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/auth/authService.js';
import { setBlingClientOverride } from '../src/bling/clientFactory.js';
import { FakeBlingClient } from '../src/bling/fakeClient.js';
import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { clearSettingsCache, updateSettings } from '../src/lib/settings.js';
import { waitWhatsAppIdle } from '../src/routes/whatsapp.js';
import { invalidateStockOverview } from '../src/stock/overview.js';
import { invalidateProductCache } from '../src/stock/productSearch.js';
import { runFullSync } from '../src/sync/syncService.js';
import { setWhatsAppTransportForTests } from '../src/whatsapp/api.js';
import { normalizePhone, phoneVariants } from '../src/whatsapp/phone.js';

/**
 * Bot de WhatsApp: a Meta é simulada (mensagens assinadas chegando no webhook) e todos os envios
 * do bot são capturados, sem chamar a internet.
 */

const PRODUCT = 6001;
const CASSIANO = '5511987654321';
const ADRIANA = '5521912345678';
const GESTOR = '5511900001111';
const ESTRANHO = '5511955554444';

let sent: any[] = [];
let app: Awaited<ReturnType<typeof buildApp>>;
let seq = 0;

function state() {
  return {
    products: [{ id: PRODUCT, nome: 'Rack Outdoor IP55', codigo: 'OSTT-061860', formato: 'S', situacao: 'A', unidade: 'UN' }],
    deposits: [{ id: 21, descricao: 'Matriz', padrao: true, desconsiderarSaldo: false, situacao: 1 }],
    balances: [{ productId: PRODUCT, depositId: 21, physical: 10, virtual: 10 }],
    salesOrders: [] as any[],
    purchaseOrders: [],
    modules: [{ id: 1, nome: 'Vendas' }],
    situations: { 1: [{ id: 15, nome: 'Em andamento' }] },
  };
}

/** Simula a Meta entregando uma mensagem (texto ou toque num botão/menu). */
async function receive(from: string, msg: { text?: string; reply?: string }, id = `wamid.${++seq}`) {
  const message = msg.reply
    ? { from, id, timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: msg.reply, title: 'x' } } }
    : { from, id, timestamp: '1', type: 'text', text: { body: msg.text } };
  const payload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '999000' }, messages: [message] } }] }],
  });
  const sig = createHmac('sha256', 'segredo-whatsapp-teste').update(payload).digest('hex');
  const res = await app.inject({ method: 'POST', url: '/api/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${sig}` }, payload });
  await waitWhatsAppIdle();
  return res;
}

const to = (phone: string) => sent.filter((p) => p.to === phone && p.type !== undefined);
const textOf = (p: any) => p.text?.body ?? p.interactive?.body?.text ?? '';
const allText = (phone: string) => to(phone).map(textOf).join('\n---\n');

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool, () => undefined);
  setWhatsAppTransportForTests(async (payload) => {
    sent.push(payload);
    return { ok: true, status: 200, body: { messages: [{ id: 'out' }] } };
  });
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  setWhatsAppTransportForTests(null);
  setBlingClientOverride(null);
  await app.close();
  await pool.end();
});

let cassiano: string;
let adriana: string;

beforeEach(async () => {
  await pool.query(`TRUNCATE reservations, reservation_history, sales_orders, sales_order_items, stock_balances, products, deposits,
    situations, situation_rules, sync_state, sync_runs, jobs, alerts, audit_log, query_history, sessions, users, settings,
    whatsapp_sessions, whatsapp_messages, purchase_requests CASCADE`);
  clearSettingsCache();
  invalidateStockOverview();
  invalidateProductCache();
  await updateSettings({ appMode: 'demo', reservations: { autoApproveSellers: true } as any, security: { mfaRequiredFor: [] } }, null);
  const fake = new FakeBlingClient(state());
  setBlingClientOverride(fake);
  await runFullSync(fake, 'teste');
  const c = await createUser({ username: 'cassiano', name: 'Cassiano Souza', password: 'SenhaForte123', role: 'vendedor' });
  const a = await createUser({ username: 'adriana', name: 'Adriana Lima', password: 'SenhaForte123', role: 'vendedor' });
  const g = await createUser({ username: 'gestor', name: 'Gestor Estoque', password: 'SenhaForte123', role: 'gestor' });
  cassiano = c.id;
  adriana = a.id;
  await pool.query('UPDATE users SET whatsapp_phone = $2 WHERE id = $1', [c.id, CASSIANO]);
  await pool.query('UPDATE users SET whatsapp_phone = $2 WHERE id = $1', [a.id, ADRIANA]);
  await pool.query('UPDATE users SET whatsapp_phone = $2 WHERE id = $1', [g.id, GESTOR]);
  sent = [];
});

describe('WhatsApp: números de telefone', () => {
  it('normaliza o que o administrador digitar e reconhece o número com e sem o nono dígito', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('+55 11 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('011 98765 4321')).toBe('5511987654321');
    expect(normalizePhone('123')).toBeNull();
    expect(phoneVariants('5511987654321')).toContain('551187654321');
    expect(phoneVariants('551187654321')).toContain('5511987654321');
  });
});

describe('WhatsApp: segurança do webhook', () => {
  it('verificação da Meta só com o token correto', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-verificacao-teste&hub.challenge=abc123' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('abc123');
    const bad = await app.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=abc123' });
    expect(bad.statusCode).toBe(403);
  });

  it('mensagem sem assinatura válida é recusada e não é processada', async () => {
    const payload = JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: CASSIANO, id: 'x1', type: 'text', text: { body: 'oi' } }] } }] }] });
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=forjada' }, payload });
    expect(res.statusCode).toBe(401);
    await waitWhatsAppIdle();
    expect(sent).toHaveLength(0);
  });

  it('número NÃO cadastrado: o bot não responde absolutamente nada (nem marca como lida)', async () => {
    const res = await receive(ESTRANHO, { text: 'oi, quanto tem do OSTT-061860?' });
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(0);
    const { rows } = await pool.query('SELECT authorized FROM whatsapp_messages WHERE wa_from = $1', [ESTRANHO]);
    expect(rows[0].authorized).toBe(false);
  });

  it('usuário desativado deixa de ser atendido', async () => {
    await pool.query('UPDATE users SET active = false WHERE id = $1', [cassiano]);
    await receive(CASSIANO, { text: 'oi' });
    expect(sent).toHaveLength(0);
  });

  it('a mesma mensagem reenviada pela Meta é respondida uma única vez', async () => {
    await receive(CASSIANO, { text: 'oi' }, 'wamid.repetida');
    const n = sent.length;
    await receive(CASSIANO, { text: 'oi' }, 'wamid.repetida');
    expect(sent.length).toBe(n);
  });
});

describe('WhatsApp: atendimento', () => {
  it('"oi" de um número cadastrado: marca como lida e mostra o menu com o nome da pessoa', async () => {
    await receive(CASSIANO, { text: 'oi' });
    expect(sent.some((p) => p.status === 'read')).toBe(true);
    const menu = to(CASSIANO).find((p) => p.interactive?.type === 'list');
    expect(menu).toBeTruthy();
    expect(textOf(menu)).toContain('Cassiano');
    // vendedor não vê opções de gestor
    expect(JSON.stringify(menu)).not.toContain('m:aprovar');
  });

  it('reconhece o número mesmo quando o WhatsApp manda sem o nono dígito', async () => {
    await receive('551187654321', { text: 'oi' });
    expect(allText('551187654321')).toContain('Cassiano');
  });

  it('consulta de produto pelo SKU mostra o disponível para venda', async () => {
    await receive(CASSIANO, { text: 'quanto tem do OSTT-061860?' });
    const txt = allText(CASSIANO);
    expect(txt).toContain('OSTT-061860');
    expect(txt).toMatch(/dispon[ií]vel/i);
    expect(txt).toContain('10');
    // os dígitos do SKU não podem virar quantidade ("Não é possível atender 61860")
    expect(txt).not.toContain('61860 UN');
  });

  it('reserva por texto + confirmação: fica no nome de quem pediu', async () => {
    await receive(CASSIANO, { text: 'reservar 3 OSTT-061860 para Construtora Alfa' });
    expect(allText(CASSIANO)).toContain('Confira a reserva');
    await receive(CASSIANO, { reply: 'ok' });
    const { rows } = await pool.query('SELECT * FROM reservations');
    expect(rows).toHaveLength(1);
    expect(rows[0].seller_user_id).toBe(cassiano);
    expect(Number(rows[0].quantity)).toBe(3);
    expect(rows[0].customer_name).toBe('Construtora Alfa');
    expect(rows[0].status).toBe('ACTIVE');
    expect(allText(CASSIANO)).toContain('Reserva ativa');
  });

  it('reserva passo a passo (produto → quantidade → cliente → sim)', async () => {
    await receive(CASSIANO, { text: 'reservar' });
    await receive(CASSIANO, { text: 'OSTT-061860' });
    await receive(CASSIANO, { text: '2' });
    await receive(CASSIANO, { text: 'Loja Beta' });
    await receive(CASSIANO, { text: 'sim' });
    const { rows } = await pool.query('SELECT customer_name, quantity FROM reservations');
    expect(rows[0]).toMatchObject({ customer_name: 'Loja Beta' });
  });

  it('privacidade: Adriana não vê reservas, clientes nem nomes do Cassiano', async () => {
    await receive(CASSIANO, { text: 'reservar 3 OSTT-061860 para Construtora Sigilosa' });
    await receive(CASSIANO, { reply: 'ok' });
    sent = [];
    await receive(ADRIANA, { text: 'minhas reservas' });
    await receive(ADRIANA, { text: 'quanto tem do OSTT-061860?' });
    await receive(ADRIANA, { text: 'O que o cliente Construtora tem reservado?' });
    const everything = JSON.stringify(to(ADRIANA));
    expect(everything).not.toContain('Sigilosa');
    expect(everything).not.toContain('Cassiano');
    expect(allText(ADRIANA)).toContain('não tem reservas');
    // o disponível dela já considera a reserva do colega (7 de 10), sem dizer de quem é
    expect(allText(ADRIANA)).toContain('7');
  });

  it('cancelar a própria reserva pelo WhatsApp; não consegue cancelar a de outra pessoa', async () => {
    await receive(CASSIANO, { text: 'reservar 1 OSTT-061860 para Fulano' });
    await receive(CASSIANO, { reply: 'ok' });
    const { rows } = await pool.query('SELECT id FROM reservations');
    const id = rows[0].id;
    await receive(ADRIANA, { reply: `rcx:${id}` });
    expect((await pool.query('SELECT status FROM reservations WHERE id = $1', [id])).rows[0].status).toBe('ACTIVE');
    await receive(CASSIANO, { reply: `rcx:${id}` });
    expect((await pool.query('SELECT status FROM reservations WHERE id = $1', [id])).rows[0].status).toBe('CANCELLED');
  });

  it('solicitação de compra: registra no nome do vendedor e avisa o gestor', async () => {
    await receive(ADRIANA, { text: 'solicitar compra 20 OSTT-061860' });
    await receive(ADRIANA, { reply: 'skip' }); // sem cliente
    await receive(ADRIANA, { text: 'urgente, cliente esperando' }); // observação
    expect(allText(ADRIANA)).toContain('Confira a solicitação');
    await receive(ADRIANA, { reply: 'ok' });
    const { rows } = await pool.query('SELECT * FROM purchase_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0].requested_by).toBe(adriana);
    expect(Number(rows[0].quantity)).toBe(20);
    expect(rows[0].source).toBe('whatsapp');
    expect(allText(GESTOR)).toContain('Nova solicitação de compra');
    // o gestor marca como comprado e a Adriana recebe o aviso
    sent = [];
    await receive(GESTOR, { reply: `ps:${rows[0].id}:ORDERED` });
    await receive(GESTOR, { reply: 'skip' });
    expect((await pool.query('SELECT status FROM purchase_requests')).rows[0].status).toBe('ORDERED');
    expect(allText(ADRIANA)).toContain('Comprado');
    // vendedor não pode mudar o status
    await receive(CASSIANO, { reply: `ps:${rows[0].id}:RECEIVED` });
    await receive(CASSIANO, { reply: 'skip' });
    expect((await pool.query('SELECT status FROM purchase_requests')).rows[0].status).toBe('ORDERED');
  });

  it('produto fora do cadastro também pode ser pedido para compra', async () => {
    await receive(CASSIANO, { text: 'solicitar compra' });
    await receive(CASSIANO, { text: 'Cabo de fibra óptica 12 vias' });
    await receive(CASSIANO, { text: '100' });
    await receive(CASSIANO, { reply: 'skip' });
    await receive(CASSIANO, { reply: 'skip' });
    await receive(CASSIANO, { reply: 'ok' });
    const { rows } = await pool.query('SELECT product_id, product_text FROM purchase_requests');
    expect(rows[0].product_id).toBeNull();
    expect(rows[0].product_text).toContain('fibra');
  });

  it('"cancelar" no meio de um fluxo desiste sem registrar nada', async () => {
    await receive(CASSIANO, { text: 'reservar 2 OSTT-061860 para Fulano' });
    await receive(CASSIANO, { text: 'cancelar' });
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM reservations')).rows[0].n).toBe(0);
  });
});
