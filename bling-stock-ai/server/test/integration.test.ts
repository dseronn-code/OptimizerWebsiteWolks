import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { answerQuestion } from '../src/ai/agent.js';
import { simplifySchema } from '../src/ai/openaiCompatAgent.js';
import { config } from '../src/config.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createUser } from '../src/auth/authService.js';
import { setBlingClientOverride } from '../src/bling/clientFactory.js';
import { FakeBlingClient } from '../src/bling/fakeClient.js';
import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { clearSettingsCache, updateSettings } from '../src/lib/settings.js';
import { approveReservation, createReservation, ReservationError } from '../src/reservations/reservationService.js';
import { getAvailability } from '../src/stock/stockService.js';
import { runDueJobs } from '../src/sync/jobs.js';
import { jobHandlers, processWebhookEvent } from '../src/sync/processors.js';
import { runFullSync, syncSalesOrders, upsertSalesOrder } from '../src/sync/syncService.js';
import { ingestEvent } from '../src/sync/webhooks.js';

/**
 * Testes de integração com PostgreSQL real e o simulador da API do Bling.
 * Cobrem os cenários que dependem de banco: concorrência (11), falha de sincronização (12),
 * eventos fora de ordem (13), idempotência de webhooks e controle de acesso.
 */

const PRODUCT = 5001;
const DEP_A = 11;
const DEP_B = 12;
const SIT_CONFIRMADO = 15;
const SIT_ATENDIDO = 9;
const SIT_CANCELADO = 12;

function freshState() {
  return {
    products: [{ id: PRODUCT, nome: 'Produto Teste', codigo: 'TST-1', formato: 'S', situacao: 'A', unidade: 'UN' }],
    deposits: [
      { id: DEP_A, descricao: 'Depósito A', padrao: true, desconsiderarSaldo: false, situacao: 1 },
      { id: DEP_B, descricao: 'Depósito B', padrao: false, desconsiderarSaldo: false, situacao: 1 },
    ],
    balances: [
      { productId: PRODUCT, depositId: DEP_A, physical: 10, virtual: 10 },
      { productId: PRODUCT, depositId: DEP_B, physical: 0, virtual: 0 },
    ],
    salesOrders: [] as any[],
    purchaseOrders: [],
    modules: [{ id: 1, nome: 'Vendas' }],
    situations: { 1: [{ id: SIT_CONFIRMADO, nome: 'Em andamento' }, { id: SIT_ATENDIDO, nome: 'Atendido' }, { id: SIT_CANCELADO, nome: 'Cancelado' }] },
  };
}

let fake: FakeBlingClient;
let seller1: { id: string; role: 'vendedor'; blingSellerId: null };
let seller2: { id: string; role: 'vendedor'; blingSellerId: null };
let manager: { id: string; role: 'gestor'; blingSellerId: null };

async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool, () => undefined);
  clearSettingsCache();
}

beforeAll(async () => {
  await resetDb();
});

afterAll(async () => {
  setBlingClientOverride(null);
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE reservations, reservation_history, sales_orders, sales_order_items, sales_order_situation_history,
    stock_balances, product_components, products, deposits, situations, situation_rules, sync_state, sync_runs, jobs,
    webhook_events, alerts, audit_log, query_history, sessions, users, settings, order_overrides, item_fulfillments CASCADE`);
  clearSettingsCache();
  await updateSettings({ appMode: 'demo', reservations: { autoApproveSellers: true } as any }, null);
  fake = new FakeBlingClient(freshState());
  setBlingClientOverride(fake);
  await pool.query(
    `INSERT INTO situation_rules (situation_id, category, stock_effect, virtual_effect) VALUES
     ($1, 'COMMITTED', 'NOT_POSTED', 'REFLECTED'), ($2, 'FULFILLED', 'POSTED', 'REFLECTED'), ($3, 'CANCELLED', 'NOT_POSTED', 'NOT_REFLECTED')`,
    [SIT_CONFIRMADO, SIT_ATENDIDO, SIT_CANCELADO],
  );
  await runFullSync(fake, 'teste');
  const u1 = await createUser({ username: 'vend1', name: 'Vendedor 1', password: 'SenhaForte123', role: 'vendedor' });
  const u2 = await createUser({ username: 'vend2', name: 'Vendedor 2', password: 'SenhaForte123', role: 'vendedor' });
  const g = await createUser({ username: 'gestor', name: 'Gestor', password: 'SenhaForte123', role: 'gestor' });
  seller1 = { id: u1.id, role: 'vendedor', blingSellerId: null };
  seller2 = { id: u2.id, role: 'vendedor', blingSellerId: null };
  manager = { id: g.id, role: 'gestor', blingSellerId: null };
});

describe('sincronização e disponibilidade (integração)', () => {
  it('sincroniza produto, depósitos e saldos do Bling', async () => {
    const r = await getAvailability(PRODUCT);
    expect(r?.physicalTotal).toBe(10);
    expect(r?.byDeposit).toHaveLength(2);
    expect(r?.status).toBe('CONFIRMED');
  });

  it('pedido confirmado sincronizado reduz a disponibilidade; ao ser atendido (baixa) não desconta duas vezes', async () => {
    fake.state.salesOrders.push({
      id: 900, numero: 1, data: new Date().toISOString().slice(0, 10), contato: { id: 1, nome: 'Cliente X' },
      situacao: { id: SIT_CONFIRMADO, valor: 0 }, itens: [{ id: 1, quantidade: 4, produto: { id: PRODUCT }, codigo: 'TST-1' }],
    });
    await syncSalesOrders(fake, { full: true });
    expect((await getAvailability(PRODUCT))?.availableForSale).toBe(6);

    // Bling: pedido atendido e estoque baixado (físico 10 → 6)
    fake.state.salesOrders[0].situacao = { id: SIT_ATENDIDO, valor: 1 };
    fake.state.balances[0].physical = 6;
    await syncSalesOrders(fake, { full: true });
    await jobHandlers.sync_incremental({});
    const r = await getAvailability(PRODUCT, { freshness: 'critical' });
    expect(r?.physicalTotal).toBe(6);
    expect(r?.availableForSale).toBe(6); // não 2
  });

  it('11. dois vendedores tentando reservar o último saldo: apenas um consegue', async () => {
    const attempt = (who: typeof seller1) =>
      createReservation({ productId: PRODUCT, quantity: 10, customerName: `Cliente de ${who.id.slice(0, 4)}`, reason: 'último saldo' }, who)
        .then(() => 'ok')
        .catch((e) => (e instanceof ReservationError ? 'recusada' : `erro: ${e.message}`));
    const results = await Promise.all([attempt(seller1), attempt(seller2)]);
    expect(results.sort()).toEqual(['ok', 'recusada']);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM reservations WHERE status = 'ACTIVE'");
    expect(rows[0].n).toBe(1);
    expect((await getAvailability(PRODUCT))?.availableForSale).toBe(0);
  });

  it('11b. aprovações concorrentes de reservas pendentes não ultrapassam o saldo', async () => {
    await updateSettings({ reservations: { autoApproveSellers: false } as any }, null);
    const a = await createReservation({ productId: PRODUCT, quantity: 7, customerName: 'A', reason: 'x' }, seller1);
    const b = await createReservation({ productId: PRODUCT, quantity: 7, customerName: 'B', reason: 'x' }, seller2);
    expect(a.reservation.status).toBe('PENDING');
    const results = await Promise.allSettled([
      approveReservation(a.reservation.id, manager),
      approveReservation(b.reservation.id, manager),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await getAvailability(PRODUCT))?.availableForSale).toBe(3);
  });

  it('reserva vinculada a pedido sincronizado depois não gera desconto independente', async () => {
    const { reservation } = await createReservation({ productId: PRODUCT, quantity: 5, customerName: 'Cliente Y', reason: 'negociação', blingOrderId: 901 }, manager);
    expect((await getAvailability(PRODUCT))?.availableForSale).toBe(5);
    fake.state.salesOrders.push({
      id: 901, numero: 2, data: new Date().toISOString().slice(0, 10), contato: { id: 2, nome: 'Cliente Y' },
      situacao: { id: SIT_CONFIRMADO, valor: 0 }, itens: [{ id: 2, quantidade: 5, produto: { id: PRODUCT } }],
    });
    await syncSalesOrders(fake, { full: true });
    const r = await getAvailability(PRODUCT);
    expect(r?.availableForSale).toBe(5); // 10 − 5 (uma única vez)
    expect(r?.lines.find((l) => l.kind === 'RESERVATION')?.treatment).toBe('SUPERSEDED');
    await jobHandlers.expire_reservations({});
    const { rows } = await pool.query('SELECT status FROM reservations WHERE id = $1', [reservation.id]);
    expect(rows[0].status).toBe('CONVERTED');
  });

  it('12. falha de sincronização com o Bling torna a disponibilidade não confirmada e é registrada', async () => {
    fake.failAll = true;
    await expect(syncSalesOrders(fake)).rejects.toThrow(/indisponível/);
    const r = await getAvailability(PRODUCT, { freshness: 'critical' });
    expect(r?.status).toBe('UNCONFIRMED');
    expect(r?.issues.map((i) => i.code)).toContain('SYNC_FAILED');
    const runs = await pool.query("SELECT status FROM sync_runs WHERE kind = 'sales_orders' ORDER BY id DESC LIMIT 1");
    expect(runs.rows[0].status).toBe('error');
    // após recuperação, volta a confirmar
    fake.failAll = false;
    await syncSalesOrders(fake);
    expect((await getAvailability(PRODUCT, { freshness: 'critical' }))?.status).toBe('CONFIRMED');
  });

  it('jobs com falha são re-tentados com atraso e concluídos quando o Bling volta', async () => {
    fake.failNext = 1;
    await pool.query("INSERT INTO jobs (type, payload) VALUES ('sync_incremental', '{}')");
    await runDueJobs(jobHandlers);
    let job = (await pool.query('SELECT status, attempts, run_at FROM jobs')).rows[0];
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect(job.run_at.getTime()).toBeGreaterThan(Date.now());
    await pool.query('UPDATE jobs SET run_at = now()');
    await runDueJobs(jobHandlers);
    job = (await pool.query('SELECT status FROM jobs')).rows[0];
    expect(job.status).toBe('done');
  });

  it('13. mudança de situação recebida fora de ordem não sobrescreve estado mais novo', async () => {
    const base = { id: 902, numero: 3, data: new Date().toISOString().slice(0, 10), contato: { id: 3, nome: 'Cliente Z' }, itens: [{ id: 3, quantidade: 6, produto: { id: PRODUCT } }] };
    const t1 = new Date(Date.now() - 60000);
    const t2 = new Date();
    // evento novo (cancelado) aplicado primeiro; o antigo (confirmado) chega depois
    expect(await upsertSalesOrder({ ...base, situacao: { id: SIT_CANCELADO } }, t2, 'webhook', 'demo')).toBe('applied');
    expect(await upsertSalesOrder({ ...base, situacao: { id: SIT_CONFIRMADO } }, t1, 'webhook', 'demo')).toBe('stale');
    const { rows } = await pool.query('SELECT situation_id FROM sales_orders WHERE id = 902');
    expect(rows[0].situation_id).toBe(SIT_CANCELADO);
    expect((await getAvailability(PRODUCT))?.availableForSale).toBe(10);
  });

  it('13b. webhooks: idempotentes por eventId e eventos antigos são ignorados', async () => {
    fake.state.salesOrders.push({
      id: 903, numero: 4, data: new Date().toISOString().slice(0, 10), contato: { id: 4, nome: 'Cliente W' },
      situacao: { id: SIT_CONFIRMADO, valor: 0 }, itens: [{ id: 4, quantidade: 2, produto: { id: PRODUCT } }],
    });
    const newer = { eventId: 'ev-2', date: new Date().toISOString(), event: 'order.updated', data: { id: 903 } };
    const older = { eventId: 'ev-1', date: new Date(Date.now() - 3600000).toISOString(), event: 'order.updated', data: { id: 903 } };
    expect(await ingestEvent(newer)).toBe('queued');
    expect(await ingestEvent(newer)).toBe('duplicate');
    await processWebhookEvent('ev-2');
    expect(await ingestEvent(older)).toBe('queued');
    expect(await processWebhookEvent('ev-1')).toBe('stale');
    const ev = await pool.query("SELECT status FROM webhook_events WHERE event_id = 'ev-1'");
    expect(ev.rows[0].status).toBe('ignored');
    expect((await getAvailability(PRODUCT))?.availableForSale).toBe(8);
  });

  it('14. produto em mais de um depósito: reserva por depósito respeita o saldo do depósito', async () => {
    await expect(
      createReservation({ productId: PRODUCT, depositId: DEP_B, quantity: 1, customerName: 'C', reason: 'x' }, manager),
    ).rejects.toThrow(/insuficiente/);
    const ok = await createReservation({ productId: PRODUCT, depositId: DEP_A, quantity: 3, customerName: 'C', reason: 'x' }, manager);
    expect(ok.reservation.status).toBe('ACTIVE');
  });
});

describe('API: autenticação, perfis e webhooks', () => {
  const H = { 'x-requested-with': 'bling-stock-ai', 'content-type': 'application/json' };

  async function loginCookie(app: Awaited<ReturnType<typeof buildApp>>, username: string) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username, password: 'SenhaForte123' } });
    expect(res.statusCode).toBe(200);
    const c = res.cookies.find((x) => x.name === 'bsa_session')!;
    expect(c.httpOnly).toBe(true);
    return `bsa_session=${c.value}`;
  }

  it('exige login, aplica perfis no backend e protege contra CSRF', async () => {
    const app = await buildApp({ logger: false });
    expect((await app.inject({ method: 'GET', url: `/api/products/${PRODUCT}/availability` })).statusCode).toBe(401);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'vend1', password: 'errada' } });
    expect(bad.statusCode).toBe(401);
    const cookie = await loginCookie(app, 'vend1');
    const av = await app.inject({ method: 'GET', url: `/api/products/${PRODUCT}/availability?qty=4`, headers: { cookie } });
    expect(av.statusCode).toBe(200);
    expect(av.json().sale.possible).toBe(true);
    // vendedor não acessa o painel de gestão nem administração
    expect((await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie } })).statusCode).toBe(403);
    // sem o cabeçalho anti-CSRF, alterações são recusadas
    const noCsrf = await app.inject({ method: 'POST', url: '/api/chat', headers: { cookie, 'content-type': 'application/json' }, payload: { question: 'TST-1' } });
    expect(noCsrf.statusCode).toBe(403);
    const chat = await app.inject({ method: 'POST', url: '/api/chat', headers: { ...H, cookie }, payload: { question: 'Consigo vender 4 unidades do TST-1?' } });
    expect(chat.statusCode).toBe(200);
    expect(chat.json().answer).toMatch(/Sim, é possível atender 4/);
    const gestor = await loginCookie(app, 'gestor');
    expect((await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: gestor } })).statusCode).toBe(200);
    await app.close();
  });

  it('bloqueia o usuário após tentativas inválidas repetidas', async () => {
    const app = await buildApp({ logger: false });
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'vend2', password: 'errada' } });
    }
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'vend2', password: 'SenhaForte123' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/bloqueado/);
    await app.close();
  });

  it('webhook só é aceito com assinatura HMAC válida', async () => {
    const app = await buildApp({ logger: false });
    const payload = JSON.stringify({ eventId: 'ev-x', date: new Date().toISOString(), event: 'stock.updated', data: { produto: { id: PRODUCT } } });
    const unsigned = await app.inject({ method: 'POST', url: '/api/webhooks/bling', headers: { 'content-type': 'application/json' }, payload });
    expect(unsigned.statusCode).toBe(401);
    const sig = createHmac('sha256', 'segredo-de-teste').update(payload).digest('hex');
    const signed = await app.inject({ method: 'POST', url: '/api/webhooks/bling', headers: { 'content-type': 'application/json', 'x-bling-signature-256': `sha256=${sig}` }, payload });
    expect(signed.statusCode).toBe(200);
    expect(signed.json().outcome).toBe('queued');
    await app.close();
  });

  it('vendedor não vê o nome do cliente de outro vendedor', async () => {
    await createReservation({ productId: PRODUCT, quantity: 2, customerName: 'Cliente Sigiloso', reason: 'x' }, seller2);
    const asSeller1 = await getAvailability(PRODUCT, { viewer: seller1 });
    expect(asSeller1?.lines[0].customerName).toBe('Cliente de outro vendedor');
    const asManager = await getAvailability(PRODUCT, { viewer: manager });
    expect(asManager?.lines[0].customerName).toBe('Cliente Sigiloso');
  });
});

describe('IA via provedor compatível com OpenAI (Groq, Gemini…)', () => {
  it('executa a ferramenta pedida pelo modelo e usa os números do motor', async () => {
    const requests: any[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body);
        requests.push({ auth: req.headers.authorization, url: req.url, body: json });
        const last = json.messages[json.messages.length - 1];
        const message =
          last.role === 'tool'
            ? { role: 'assistant', content: `Resposta: ${JSON.parse(last.content).verificacao.mensagem}` }
            : { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'verificar_venda', arguments: '{"produto":"TST-1","quantidade":4}' } }] };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message, finish_reason: last.role === 'tool' ? 'stop' : 'tool_calls' }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const saved = { ...config };
    Object.assign(config, {
      AI_PROVIDER: 'openai_compat',
      AI_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      AI_API_KEY: 'chave-gratis-teste',
      AI_MODEL: 'modelo-teste',
    });
    try {
      const r = await answerQuestion('posso vender 4 do tst-1?', [], seller1, null);
      expect(r.engine).toBe('llm');
      expect(r.answer).toContain('Sim, é possível atender 4');
      expect(r.toolCalls).toEqual([{ name: 'verificar_venda', input: { produto: 'TST-1', quantidade: 4 } }]);
      expect(r.cards[0].type).toBe('availability');
      expect(requests[0].url).toBe('/v1/chat/completions');
      expect(requests[0].auth).toBe('Bearer chave-gratis-teste');
      expect(requests[0].body.tools).toHaveLength(11);
    } finally {
      Object.assign(config, saved);
      server.close();
    }
  });

  it('simplifica o JSON Schema das ferramentas para provedores mais restritos', () => {
    const out = simplifySchema({ $schema: 'x', type: 'object', additionalProperties: false, properties: { q: { type: 'number', exclusiveMinimum: 0, pattern: 'a' } }, required: ['q'] });
    expect(out).toEqual({ type: 'object', properties: { q: { type: 'number', minimum: 0 } }, required: ['q'] });
  });
});
