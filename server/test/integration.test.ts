import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { answerQuestion } from '../src/ai/agent.js';
import { simplifySchema } from '../src/ai/openaiCompatAgent.js';
import { config } from '../src/config.js';
import { setEmailTransportForTests } from '../src/lib/email.js';
import { currentCounter, totpAt } from '../src/lib/totp.js';
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
import { purgeDemoData } from '../src/demo/purge.js';
import { invalidateStockOverview } from '../src/stock/overview.js';
import { invalidateProductCache } from '../src/stock/productSearch.js';
import { runDueJobs } from '../src/sync/jobs.js';
import { jobHandlers, processWebhookEvent } from '../src/sync/processors.js';
import { runFullSync, syncAllBalances, syncProducts, syncSalesOrders, upsertSalesOrder } from '../src/sync/syncService.js';
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
    webhook_events, alerts, audit_log, query_history, sessions, users, settings, order_overrides, item_fulfillments, email_verifications, mfa_challenges CASCADE`);
  clearSettingsCache();
  invalidateStockOverview();
  await updateSettings({ appMode: 'demo', reservations: { autoApproveSellers: true } as any, security: { mfaRequiredFor: [] } }, null);
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
    const line = asSeller1!.lines.find((l) => l.kind === 'RESERVATION')!;
    // o vendedor não vê cliente, nem de quem é: só que existe um compromisso que reduz o disponível
    expect(line.customerName).toBeNull();
    expect(line.label).toBe('Reserva de outro vendedor');
    expect(line.subtracted).toBe(2);
    expect(JSON.stringify(asSeller1)).not.toContain('Cliente Sigiloso');
    const asManager = await getAvailability(PRODUCT, { viewer: manager });
    expect(asManager?.lines.find((l) => l.kind === 'RESERVATION')?.customerName).toBe('Cliente Sigiloso');
    // nem a lista de reservas do colega aparece para o vendedor
    const { listReservations } = await import('../src/reservations/reservationService.js');
    const list = await listReservations({}, seller1);
    expect(list.every((r: { seller_user_id: string }) => r.seller_user_id === seller1.id)).toBe(true);
  });
});

describe('interpretador local: perguntas gerais', () => {
  it('lista produtos disponíveis e ignora palavras comuns como "são nossos" e "estão"', async () => {
    for (const q of ['Quais são nossos produtos disponíveis para venda?', 'Quais produtos estão disponíveis para venda?', 'o que temos em estoque?']) {
      const r = await answerQuestion(q, [], seller1, null);
      expect(r.answer).toContain('Produtos disponíveis para venda');
      expect(r.answer).toContain('TST-1');
      expect(r.toolCalls[0].name).toBe('listar_produtos');
    }
  });

  it('SKU exato não é ambíguo com outro SKU que começa igual (ex.: OSTT-061860 × OSTT-061860-GLM)', async () => {
    await pool.query(
      `INSERT INTO products (id, sku, name, format, kind, search_text) VALUES
         (880001, 'OSTT-061860', 'Rack Outdoor IP55 18U', 'S', 'P', 'ostt-061860 rack outdoor ip55 18u'),
         (880002, 'OSTT-061860-GLM', 'Rack Outdoor IP65 18U', 'S', 'P', 'ostt-061860-glm rack outdoor ip65 18u')
       ON CONFLICT (id) DO NOTHING`,
    );
    invalidateProductCache();
    const { resolveProduct } = await import('../src/ai/tools.js');
    const ctx = { viewer: seller1, cards: [], lastProductId: null };
    const r = await resolveProduct('OSTT-061860', ctx);
    expect('product' in r && r.product.id).toBe(880001);
    const r2 = await resolveProduct('ostt-061860-glm', ctx);
    expect('product' in r2 && r2.product.id).toBe(880002);
    await pool.query('DELETE FROM products WHERE id IN (880001, 880002)');
    invalidateProductCache();
  });

  it('lista por categoria traz primeiro o próprio produto, não os acessórios que só citam o nome', async () => {
    await pool.query(
      `INSERT INTO products (id, sku, name, format, kind, search_text) VALUES
         (880011, 'ETQ-1', 'Etiqueta Resinada Para Racks e Painéis', 'S', 'P', ''),
         (880012, 'CBAP-4', 'Kit Cinta BAP Fixação De Rack', 'S', 'P', ''),
         (880013, 'ECOB-0604-06', 'Rack Outdoor Econo-BOX 6U x 400mm', 'S', 'P', '')`,
    );
    await pool.query(
      `INSERT INTO stock_balances (product_id, deposit_id, physical, virtual, fetched_at) VALUES
         (880011, $1, 1290, 1290, now()), (880012, $1, 1230, 1230, now()), (880013, $1, 77, 77, now())`,
      [DEP_A],
    );
    invalidateStockOverview();
    const r = await answerQuestion('olá, temos quais tamanhos de rack disponiveis para venda', [], seller1, null);
    const table = r.cards.find((c) => c.type === 'table') as { rows: (string | number | null)[][] } | undefined;
    expect(table?.rows[0][0]).toBe('ECOB-0604-06');
    await pool.query('DELETE FROM stock_balances WHERE product_id IN (880011, 880012, 880013)');
    await pool.query('DELETE FROM products WHERE id IN (880011, 880012, 880013)');
    invalidateStockOverview();
  });

  it('produto inexistente gera orientação em vez de erro', async () => {
    const r = await answerQuestion('quanto temos do parafuso xyz?', [], seller1, null);
    expect(r.answer).toMatch(/Não encontrei um produto/);
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
      expect(requests[0].body.tools).toHaveLength(12);
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

describe('cadastro com código por e-mail', () => {
  const H = { 'x-requested-with': 'bling-stock-ai', 'content-type': 'application/json' };
  let sent: { to: string; subject: string; text: string }[] = [];
  const lastCode = () => sent[sent.length - 1].text.match(/\b(\d{6})\b/)![1];

  beforeEach(() => {
    sent = [];
    setEmailTransportForTests(async (m) => {
      sent.push(m);
    });
  });
  afterAll(() => setEmailTransportForTests(null));

  it('envia código, recusa código errado, cria conta pendente e só entra após aprovação', async () => {
    const app = await buildApp({ logger: false });
    const start = await app.inject({ method: 'POST', url: '/api/auth/signup/start', headers: H, payload: { name: 'Nova Vendedora', email: 'Nova@Empresa.com.br', password: 'SenhaNova2026' } });
    expect(start.statusCode).toBe(200);
    expect(sent[0].to).toBe('nova@empresa.com.br');
    const { verificationId } = start.json();
    // a senha não fica salva em texto
    const stored = await pool.query('SELECT payload::text AS p FROM email_verifications WHERE id = $1', [verificationId]);
    expect(stored.rows[0].p).not.toContain('SenhaNova2026');

    const wrong = await app.inject({ method: 'POST', url: '/api/auth/signup/verify', headers: H, payload: { verificationId, code: lastCode() === '000000' ? '111111' : '000000' } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toMatch(/Restam 4/);

    const ok = await app.inject({ method: 'POST', url: '/api/auth/signup/verify', headers: H, payload: { verificationId, code: lastCode() } });
    expect(ok.json().status).toBe('pending_approval');

    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'nova@empresa.com.br', password: 'SenhaNova2026' } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toMatch(/aguardando aprovação/);

    // administrador aprova
    await createUser({ username: 'adm', name: 'Adm', password: 'SenhaForte123', role: 'admin' });
    const admLogin = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'adm', password: 'SenhaForte123' } });
    const cookie = `bsa_session=${admLogin.cookies.find((c) => c.name === 'bsa_session')!.value}`;
    const users = (await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie } })).json().users;
    const nova = users.find((u: any) => u.email === 'nova@empresa.com.br');
    expect(nova.pending_approval).toBe(true);
    await app.inject({ method: 'PUT', url: `/api/admin/users/${nova.id}`, headers: { ...H, cookie }, payload: { approve: true } });

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'nova@empresa.com.br', password: 'SenhaNova2026' } });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.role).toBe('vendedor');
    await app.close();
  });

  it('sem aprovação obrigatória, entra direto após confirmar o código; código não pode ser reutilizado', async () => {
    await updateSettings({ signup: { requireApproval: false } as any }, null);
    const app = await buildApp({ logger: false });
    const { verificationId } = (await app.inject({ method: 'POST', url: '/api/auth/signup/start', headers: H, payload: { name: 'Direto', email: 'direto@empresa.com.br', password: 'SenhaNova2026' } })).json();
    const code = lastCode();
    const ok = await app.inject({ method: 'POST', url: '/api/auth/signup/verify', headers: H, payload: { verificationId, code } });
    expect(ok.json().status).toBe('active');
    expect(ok.cookies.find((c) => c.name === 'bsa_session')).toBeTruthy();
    const again = await app.inject({ method: 'POST', url: '/api/auth/signup/verify', headers: H, payload: { verificationId, code } });
    expect(again.statusCode).toBe(404);
    await app.close();
  });

  it('respeita domínios permitidos, e-mail duplicado e cadastro desativado', async () => {
    await updateSettings({ signup: { allowedDomains: ['itcomtech.com.br'] } as any }, null);
    const app = await buildApp({ logger: false });
    const other = await app.inject({ method: 'POST', url: '/api/auth/signup/start', headers: H, payload: { name: 'Xavier', email: 'x@gmail.com', password: 'SenhaNova2026' } });
    expect(other.statusCode).toBe(400);
    expect(other.json().error).toMatch(/@itcomtech.com.br/);
    expect(sent).toHaveLength(0);
    await updateSettings({ signup: { enabled: false } as any }, null);
    const off = await app.inject({ method: 'POST', url: '/api/auth/signup/start', headers: H, payload: { name: 'Xavier', email: 'x@itcomtech.com.br', password: 'SenhaNova2026' } });
    expect(off.statusCode).toBe(403);
    await app.close();
  });
});

describe('passagem para o Bling real', () => {
  it('apaga os dados fictícios da demonstração e mantém os usuários', async () => {
    await createReservation({ productId: PRODUCT, quantity: 2, customerName: 'C', reason: 'x' }, manager);
    const before = await pool.query("SELECT COUNT(*)::int AS n FROM products WHERE source = 'demo'");
    expect(before.rows[0].n).toBeGreaterThan(0);
    const r = await purgeDemoData();
    expect(r.removedProducts).toBe(before.rows[0].n);
    for (const t of ['products', 'stock_balances', 'sales_orders', 'reservations', 'situations']) {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      expect(rows[0].n, t).toBe(0);
    }
    const users = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    expect(users.rows[0].n).toBe(3);
    expect((await purgeDemoData()).removedProducts).toBe(0); // idempotente
  });
});

describe('verificação em duas etapas (2FA)', () => {
  const H = { 'x-requested-with': 'bling-stock-ai', 'content-type': 'application/json' };

  it('gestor precisa cadastrar o app autenticador; depois entra só com senha + código', async () => {
    await updateSettings({ security: { mfaRequiredFor: ['admin', 'gestor'] } }, null);
    const app = await buildApp({ logger: false });
    const first = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'gestor', password: 'SenhaForte123' } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ mfa: 'setup' });
    expect(first.cookies.find((c) => c.name === 'bsa_session')).toBeUndefined(); // sem sessão antes do 2FA
    const { challenge } = first.json();

    const setup = (await app.inject({ method: 'POST', url: '/api/auth/mfa/setup', headers: H, payload: { challenge } })).json();
    expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    const bad = await app.inject({ method: 'POST', url: '/api/auth/mfa/setup/confirm', headers: H, payload: { challenge, code: '000000' } });
    expect(bad.statusCode).toBe(401);
    // contador fixo: o teste não pode depender de cruzar (ou não) a troca de código a cada 30 s
    const c0 = currentCounter();
    const ok = await app.inject({ method: 'POST', url: '/api/auth/mfa/setup/confirm', headers: H, payload: { challenge, code: totpAt(setup.secret, c0) } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().recoveryCodes).toHaveLength(8);
    const recovery = ok.json().recoveryCodes[0];

    // próximo login: senha + código (o mesmo código não pode ser reutilizado)
    const second = (await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'gestor', password: 'SenhaForte123' } })).json();
    expect(second.mfa).toBe('verify');
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/mfa/verify', headers: H, payload: { challenge: second.challenge, code: totpAt(setup.secret, c0) } });
    expect(reuse.statusCode).toBe(401);
    const next = await app.inject({ method: 'POST', url: '/api/auth/mfa/verify', headers: H, payload: { challenge: second.challenge, code: totpAt(setup.secret, c0 + 1) } });
    expect(next.statusCode).toBe(200);
    expect(next.cookies.find((c) => c.name === 'bsa_session')).toBeTruthy();

    // código de recuperação funciona uma única vez
    const third = (await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'gestor', password: 'SenhaForte123' } })).json();
    const rec = await app.inject({ method: 'POST', url: '/api/auth/mfa/verify', headers: H, payload: { challenge: third.challenge, code: recovery } });
    expect(rec.statusCode).toBe(200);
    expect(rec.json().recoveryCodesLeft).toBe(7);
    const fourth = (await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'gestor', password: 'SenhaForte123' } })).json();
    const again = await app.inject({ method: 'POST', url: '/api/auth/mfa/verify', headers: H, payload: { challenge: fourth.challenge, code: recovery } });
    expect(again.statusCode).toBe(401);
    await app.close();
  });

  it('5 códigos errados invalidam a etapa e geram alerta de segurança', async () => {
    await updateSettings({ security: { mfaRequiredFor: ['gestor'] } }, null);
    const app = await buildApp({ logger: false });
    const { challenge } = (await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'gestor', password: 'SenhaForte123' } })).json();
    await app.inject({ method: 'POST', url: '/api/auth/mfa/setup', headers: H, payload: { challenge } });
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/auth/mfa/setup/confirm', headers: H, payload: { challenge, code: '000000' } });
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/mfa/setup/confirm', headers: H, payload: { challenge, code: '123456' } });
    expect([401, 429]).toContain(blocked.statusCode);
    const alerts = await pool.query("SELECT 1 FROM alerts WHERE type = 'SECURITY_MFA_FAILED'");
    expect(alerts.rowCount).toBeGreaterThan(0);
    await app.close();
  });

  it('senhas óbvias são recusadas', async () => {
    const { validatePasswordPolicy } = await import('../src/auth/authService.js');
    expect(validatePasswordPolicy('senha12345')).toMatch(/comum/);
    expect(validatePasswordPolicy('davi123456789', ['davi@empresa.com'])).toMatch(/usuário/);
    expect(validatePasswordPolicy('Kq8!zT2pLm')).toBeNull();
  });
});

describe('kits (produtos com composição)', () => {
  const KIT_F = 5101;
  const KIT_V = 5102;

  async function addKits() {
    fake.state.products.push(
      { id: KIT_F, nome: 'Kit com estoque próprio', codigo: 'KIT-F', formato: 'E', situacao: 'A', estrutura: { tipoEstoque: 'F', lancamentoEstoque: 'P', componentes: [{ produto: { id: PRODUCT }, quantidade: 2 }] } } as any,
      { id: KIT_V, nome: 'Kit virtual', codigo: 'KIT-V', formato: 'E', situacao: 'A', estrutura: { tipoEstoque: 'V', lancamentoEstoque: 'M', componentes: [{ produto: { id: PRODUCT }, quantidade: 2 }] } } as any,
    );
    fake.state.balances.push({ productId: KIT_F, depositId: DEP_A, physical: -7, virtual: -7 });
    await syncProducts(fake);
    await syncAllBalances(fake);
  }

  it('kit com estoque FÍSICO usa o saldo do próprio kit (inclusive negativo)', async () => {
    await addKits();
    const r = await getAvailability(KIT_F);
    expect(r?.kit).toBeNull();
    expect(r?.physicalTotal).toBe(-7);
    expect(r?.issues.map((i) => i.code)).toContain('NEGATIVE_BALANCE');
  });

  it('kit VIRTUAL é calculado pelos componentes; pedido de kit físico não desconta componentes', async () => {
    await addKits();
    expect((await getAvailability(KIT_V))?.kit?.availableForSale).toBe(5); // 10 un. / 2 por kit
    fake.state.salesOrders.push(
      { id: 950, numero: 50, data: new Date().toISOString().slice(0, 10), contato: { id: 9, nome: 'C' }, situacao: { id: SIT_CONFIRMADO }, itens: [{ id: 50, quantidade: 1, produto: { id: KIT_F } }] },
      { id: 951, numero: 51, data: new Date().toISOString().slice(0, 10), contato: { id: 9, nome: 'C' }, situacao: { id: SIT_CONFIRMADO }, itens: [{ id: 51, quantidade: 1, produto: { id: KIT_V } }] },
    );
    await syncSalesOrders(fake, { full: true });
    // só o kit virtual (2 un. do componente) prende o produto simples
    expect((await getAvailability(PRODUCT))?.availableForSale).toBe(8);
  });
});

describe('painel de gestão: contagens', () => {
  const H = { 'x-requested-with': 'bling-stock-ai', 'content-type': 'application/json' };
  it('saldo negativo é divergência (não risco), serviço não conta e pedidos antigos aparecem', async () => {
    fake.state.products.push(
      { id: 5201, nome: 'Produto negativo', codigo: 'NEG-1', formato: 'S', situacao: 'A', tipo: 'P' } as any,
      { id: 5202, nome: 'Mão de obra', codigo: 'MAOOBRA', formato: 'S', situacao: 'A', tipo: 'S' } as any,
    );
    fake.state.balances.push({ productId: 5201, depositId: DEP_A, physical: -3, virtual: -3 }, { productId: 5202, depositId: DEP_A, physical: -18, virtual: -18 });
    fake.state.salesOrders.push({ id: 960, numero: 60, data: '2026-01-10', contato: { id: 1, nome: 'Antigo' }, situacao: { id: SIT_CONFIRMADO }, itens: [{ id: 60, quantidade: 4, produto: { id: PRODUCT } }] });
    await syncProducts(fake);
    await syncAllBalances(fake);
    await upsertSalesOrder(fake.state.salesOrders[0] as any, new Date(), 'teste', 'demo');
    const app = await buildApp({ logger: false });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'gestor', password: 'SenhaForte123' } });
    const cookie = `bsa_session=${login.cookies.find((c) => c.name === 'bsa_session')!.value}`;
    const d = (await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } })).json();
    expect(d.products.total).toBe(2); // TST-1 e NEG-1; o serviço fica fora
    expect(d.divergent.map((r: any) => r.sku)).toEqual(['NEG-1']);
    expect(d.atRisk).toHaveLength(0);
    expect(d.oldestCommitted[0]).toMatchObject({ number: 60, customer_name: 'Antigo' });
    await app.close();
  });
});

describe('tela Estoque (todos os produtos)', () => {
  const H = { 'x-requested-with': 'bling-stock-ai', 'content-type': 'application/json' };
  it('lista todos os produtos com comprometido e disponível, filtra, busca e exporta CSV', async () => {
    fake.state.products.push({ id: 5301, nome: 'Cabo Parado', codigo: 'CABO-1', formato: 'S', situacao: 'A', tipo: 'P' } as any);
    fake.state.balances.push({ productId: 5301, depositId: DEP_A, physical: 40, virtual: 40 });
    fake.state.products.push({ id: 5302, nome: 'Negativo', codigo: 'NEG-2', formato: 'S', situacao: 'A', tipo: 'P' } as any);
    fake.state.balances.push({ productId: 5302, depositId: DEP_A, physical: -500, virtual: -500 });
    fake.state.salesOrders.push({ id: 970, numero: 70, data: new Date().toISOString().slice(0, 10), contato: { id: 1, nome: 'X' }, situacao: { id: SIT_CONFIRMADO }, itens: [{ id: 70, quantidade: 3, produto: { id: PRODUCT } }] });
    await syncProducts(fake);
    await syncAllBalances(fake);
    await syncSalesOrders(fake, { full: true });
    invalidateStockOverview();
    const app = await buildApp({ logger: false });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'vend1', password: 'SenhaForte123' } });
    const cookie = `bsa_session=${login.cookies.find((c) => c.name === 'bsa_session')!.value}`;
    const all = (await app.inject({ method: 'GET', url: '/api/stock', headers: { cookie } })).json();
    expect(all.totals.products).toBe(3);
    expect(all.totals).toMatchObject({ physical: 50, negative: -500, negativeProducts: 1, availableForSale: 47 });
    // disponível nunca passa do físico positivo
    expect(all.totals.availableForSale).toBeLessThanOrEqual(all.totals.physical);
    const tst = all.rows.find((r: any) => r.sku === 'TST-1');
    expect(tst).toMatchObject({ physical: 10, committed: 3, availableForSale: 7, status: 'CONFIRMED' });
    expect(all.rows.find((r: any) => r.sku === 'CABO-1')).toMatchObject({ physical: 40, committed: 0, availableForSale: 40 });
    const committed = (await app.inject({ method: 'GET', url: '/api/stock?filter=committed', headers: { cookie } })).json();
    expect(committed.rows.map((r: any) => r.sku)).toEqual(['TST-1']);
    const search = (await app.inject({ method: 'GET', url: '/api/stock?q=cabo', headers: { cookie } })).json();
    expect(search.rows.map((r: any) => r.sku)).toEqual(['CABO-1']);
    const csv = await app.inject({ method: 'GET', url: '/api/stock?format=csv&sort=availableForSale&dir=desc', headers: { cookie } });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\n')[1]).toContain('CABO-1');
    await app.close();
  });
});
