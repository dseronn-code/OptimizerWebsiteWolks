import { answerQuestion, type ChatTurn } from '../ai/agent.js';
import { resolveProduct, type Card } from '../ai/tools.js';
import { audit } from '../audit/audit.js';
import type { SessionUser } from '../auth/authService.js';
import { pool } from '../db/pool.js';
import { brDate, brDateTime } from '../lib/labels.js';
import { log } from '../lib/log.js';
import { normalize } from '../lib/text.js';
import {
  createPurchaseRequest,
  getPurchaseRequest,
  listPurchaseRequests,
  PURCHASE_STATUS_LABEL,
  updatePurchaseRequest,
  type PurchaseStatus,
} from '../purchases/purchaseService.js';
import {
  approveReservation,
  changeReservationStatus,
  createReservation,
  listReservations,
  renewReservation,
} from '../reservations/reservationService.js';
import { getAvailability, type Viewer } from '../stock/stockService.js';
import { markRead, sendButtons, sendList, sendText, type Button } from './api.js';
import { notifyUsers } from './notify.js';
import { phoneVariants } from './phone.js';

/**
 * Bot de WhatsApp do ITCOMTECH Estoque Inteligente.
 *
 * Segurança:
 * - O número de quem envia é o "login": só números cadastrados em Administração › Usuários são atendidos.
 * - Número desconhecido: o bot NÃO responde nada e nem marca a mensagem como lida.
 * - Cada colaborador vê só o que é seu (mesmas regras de privacidade do site).
 * - Nada é alterado no Bling: reservas e solicitações de compra são registros internos.
 */

export interface IncomingMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: string;
  /** id do botão/opção escolhido em mensagens interativas */
  replyId?: string;
  replyTitle?: string;
}

type Flow =
  | { flow: 'reserve'; step: 'product' | 'qty' | 'customer' | 'confirm'; productId?: number; productLabel?: string; available?: number; unit?: string | null; qty?: number; customer?: string }
  | { flow: 'purchase'; step: 'product' | 'qty' | 'customer' | 'notes' | 'confirm'; productId?: number | null; productLabel?: string; qty?: number; customer?: string | null; notes?: string | null }
  | { flow: 'renew'; reservationId: string }
  | { flow: 'reject'; reservationId: string }
  | { flow: 'pr_note'; prId: string; status: PurchaseStatus };

interface Session {
  state: (Flow & { at: number }) | Record<string, never>;
  lastProductId: number | null;
  history: ChatTurn[];
}

const FLOW_TTL_MS = 30 * 60 * 1000;
const RATE_PER_MINUTE = 20;

const RES_STATUS: Record<string, string> = {
  PENDING: 'Aguardando aprovação',
  ACTIVE: 'Ativa',
  EXPIRED: 'Vencida',
  REJECTED: 'Recusada',
  CANCELLED: 'Cancelada',
  RELEASED: 'Liberada',
  CONVERTED: 'Convertida em pedido',
};

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 4 }));
const firstName = (name: string) => name.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] ?? name;

/** Erros internos com códigos de status → texto amigável. */
function humanize(msg: string) {
  return msg.replace(/\b(PENDING|ACTIVE|EXPIRED|REJECTED|CANCELLED|RELEASED|CONVERTED)\b/g, (s) => (RES_STATUS[s] ?? s).toLowerCase());
}

// ---------------------------------------------------------------- identificação

export async function findUserByPhone(waId: string): Promise<(SessionUser & { phone: string }) | null> {
  const { rows } = await pool.query(
    `SELECT id, username, name, role, bling_seller_id, whatsapp_phone FROM users
     WHERE whatsapp_phone = ANY($1::text[]) AND active AND NOT pending_approval LIMIT 1`,
    [phoneVariants(waId)],
  );
  const u = rows[0];
  if (!u) return null;
  return { id: u.id, username: u.username, name: u.name, role: u.role, blingSellerId: u.bling_seller_id, phone: u.whatsapp_phone };
}

const viewer = (u: SessionUser): Viewer => ({ id: u.id, role: u.role, blingSellerId: u.blingSellerId });

// ---------------------------------------------------------------- sessão

async function loadSession(userId: string, waId: string): Promise<Session> {
  const { rows } = await pool.query('SELECT state, last_product_id, history FROM whatsapp_sessions WHERE user_id = $1', [userId]);
  if (!rows[0]) {
    await pool.query('INSERT INTO whatsapp_sessions (user_id, wa_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING', [userId, waId]);
    return { state: {}, lastProductId: null, history: [] };
  }
  const state = rows[0].state ?? {};
  const expired = state.at && Date.now() - state.at > FLOW_TTL_MS;
  return { state: expired ? {} : state, lastProductId: rows[0].last_product_id ? Number(rows[0].last_product_id) : null, history: rows[0].history ?? [] };
}

async function saveSession(userId: string, waId: string, s: Session) {
  await pool.query(
    `INSERT INTO whatsapp_sessions (user_id, wa_id, state, last_product_id, history, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET wa_id = EXCLUDED.wa_id, state = EXCLUDED.state, last_product_id = EXCLUDED.last_product_id,
       history = EXCLUDED.history, updated_at = now()`,
    [userId, waId, JSON.stringify(s.state), s.lastProductId, JSON.stringify(s.history.slice(-10))],
  );
}

function setFlow(s: Session, f: Flow) {
  s.state = { ...f, at: Date.now() };
}

function clearFlow(s: Session) {
  s.state = {};
}

// ---------------------------------------------------------------- entrada

/** Retorna false se a mensagem já foi processada (a Meta pode reenviar o mesmo evento). */
async function claimMessage(m: IncomingMessage, userId: string | null): Promise<boolean> {
  const r = await pool.query(
    'INSERT INTO whatsapp_messages (wa_message_id, wa_from, user_id, authorized) VALUES ($1, $2, $3, $4) ON CONFLICT (wa_message_id) DO NOTHING',
    [m.id, m.from, userId, Boolean(userId)],
  );
  return (r.rowCount ?? 0) > 0;
}

async function overRateLimit(userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM whatsapp_messages WHERE user_id = $1 AND received_at > now() - interval '1 minute'",
    [userId],
  );
  return rows[0].n > RATE_PER_MINUTE;
}

/** Ponto de entrada: uma mensagem recebida do WhatsApp. */
export async function handleIncoming(m: IncomingMessage): Promise<void> {
  const user = await findUserByPhone(m.from);
  const fresh = await claimMessage(m, user?.id ?? null);
  // número não cadastrado: silêncio total (nem "lido"), por segurança
  if (!user || !fresh) return;
  if (await overRateLimit(user.id)) return;
  await markRead(m.id);

  const session = await loadSession(user.id, m.from);
  const ctx: Ctx = { user, to: m.from, session };
  try {
    if (m.replyId) {
      if (!(await routeFlowButton(ctx, m.replyId))) await onChoice(ctx, m.replyId);
    }
    else if (m.type === 'text' && m.text) await onText(ctx, m.text.trim());
    else await sendText(m.from, 'Por enquanto eu entendo só mensagens de texto. Escreva sua pergunta ou digite *menu*.');
  } catch (err) {
    log('whatsapp: erro ao responder', err);
    await sendText(m.from, 'Não consegui concluir agora. Tente de novo em instantes ou digite *menu*.').catch(() => undefined);
  } finally {
    await saveSession(user.id, m.from, session);
  }
}

interface Ctx {
  user: SessionUser & { phone: string };
  to: string;
  session: Session;
}

const isManager = (c: Ctx) => c.user.role !== 'vendedor';

// ---------------------------------------------------------------- menu

async function sendMenu(c: Ctx, greet = false) {
  const hello = greet ? `Olá, ${firstName(c.user.name)}! 👋\nSou o assistente de estoque da *ITCOMTECH*.\n\n` : '';
  const rows = [
    { id: 'm:consultar', title: '🔎 Consultar produto', description: 'Disponível para venda de um item' },
    { id: 'm:disponiveis', title: '✅ Disponíveis', description: 'Produtos com saldo para vender' },
    { id: 'm:sem_estoque', title: '⛔ Sem estoque', description: 'Produtos sem saldo para venda' },
    { id: 'm:reservar', title: '📌 Fazer reserva', description: 'Separar unidades para um cliente' },
    { id: 'm:minhas_reservas', title: '📋 Minhas reservas', description: 'Ver, renovar ou cancelar' },
    { id: 'm:compra', title: '🛒 Solicitar compra', description: 'Pedir um produto que está em falta' },
    { id: 'm:minhas_compras', title: '🧾 Minhas compras', description: 'Andamento das solicitações de compra' },
    { id: 'm:pedidos', title: '📦 Meus pedidos abertos', description: 'Pedidos que ainda prendem estoque' },
  ];
  if (isManager(c)) {
    rows.push({ id: 'm:aprovar', title: '✔️ Reservas p/ aprovar', description: 'Reservas aguardando o gestor' });
    rows.push({ id: 'm:compras_abertas', title: '🛍️ Compras em aberto', description: 'Solicitações de toda a equipe' });
  }
  await sendList(
    c.to,
    `${hello}Escolha uma opção no menu ou simplesmente escreva o que precisa, por exemplo:\n• _quanto tem do OSTT-061860?_\n• _consigo vender 20 cabos HDMI?_\n• _reservar 5 OSTT-061860 para Construtora Alfa_`,
    'Abrir menu',
    rows,
    'O que deseja fazer?',
  );
}

// ---------------------------------------------------------------- texto livre

const GREETING = /^(oi+|ola|ol[aá]|opa|e ai|eai|bom dia|boa tarde|boa noite|menu|inicio|início|ajuda|help|comecar|começar|start)\b[\s!.?]*$/;
const CANCEL = /^(cancelar|cancela|sair|parar|voltar|nao|não)\b[\s!.?]*$/;

async function onText(c: Ctx, raw: string) {
  const t = normalize(raw);
  const s = c.session;

  if (/^(limpar|nova conversa|recomecar|reset)\b/.test(t)) {
    s.history = [];
    s.lastProductId = null;
    clearFlow(s);
    await sendText(c.to, 'Conversa limpa. ✨ Pode perguntar do zero. Digite *menu* para ver as opções.');
    return;
  }
  if ('flow' in s.state) {
    if (CANCEL.test(t)) {
      clearFlow(s);
      await sendText(c.to, 'Tudo bem, cancelei. Digite *menu* quando quiser.');
      return;
    }
    await continueFlow(c, raw);
    return;
  }
  if (GREETING.test(t)) return sendMenu(c, true);
  if (/^(obrigad[oa]|valeu|vlw|show|ok|blz|beleza|tmj)\b[\s!.?]*$/.test(t)) {
    await sendText(c.to, 'Por nada! 😉 Quando precisar, é só chamar.');
    return;
  }

  // atalhos de texto
  if (/^minhas? reservas?\b/.test(t)) return myReservations(c);
  if (/^(minhas? )?solicitac(ao|oes) de compra|^minhas? compras?\b/.test(t)) return myPurchases(c);
  const prRef = t.match(/^compra\s*#?\s*(\d+)$/);
  if (prRef) return showPurchase(c, Number(prRef[1]));
  if (/^(solicitar|pedir|fazer) (uma )?compra|^solicitar\b|^comprar\b/.test(t)) {
    const rest = raw.replace(/^\s*(solicitar|pedir|fazer)\s+(uma\s+)?compra(\s+de)?|^\s*(solicitar|comprar)\b/i, '').trim();
    return startPurchase(c, rest);
  }
  const reserve = raw.match(/^\s*reserv(?:ar|e|a)\b\s*(.*)$/i);
  if (reserve) return startReserve(c, reserve[1]);

  // qualquer outra coisa: o assistente (IA ou interpretador local), com as permissões do colaborador
  await askAssistant(c, raw);
}

async function askAssistant(c: Ctx, question: string) {
  const s = c.session;
  const r = await answerQuestion(question, s.history, viewer(c.user), s.lastProductId);
  s.history = [...s.history, { role: 'user' as const, content: question }, { role: 'assistant' as const, content: r.answer }].slice(-10);
  s.lastProductId = r.lastProductId;

  const candidates = r.cards.find((x): x is Extract<Card, { type: 'candidates' }> => x.type === 'candidates');
  if (candidates && candidates.data.length > 1) {
    await sendList(
      c.to,
      'Encontrei mais de um produto parecido. Qual deles?',
      'Escolher produto',
      candidates.data.slice(0, 10).map((p) => ({ id: `p:${p.id}`, title: p.sku ?? p.name, description: p.name })),
      'Produtos',
    );
    return;
  }
  // um produto: sempre o cartão padrão (números do motor, mesmo visual), com o veredito da venda se houve pergunta de quantidade
  const avail = r.cards.filter((x): x is Extract<Card, { type: 'availability' }> => x.type === 'availability');
  const uniqueIds = [...new Set(avail.map((a) => a.data.product.id))];
  if (uniqueIds.length === 1) {
    const last = avail[avail.length - 1];
    await showProduct(c, uniqueIds[0], last.sale ?? null);
    return;
  }
  // listas (produtos, pedidos, reservas, entradas…): formatadas para o WhatsApp
  const tables = r.cards.filter((x): x is Extract<Card, { type: 'table' }> => x.type === 'table');
  if (tables.length) {
    for (const t of tables.slice(0, 2)) await sendText(c.to, formatTable(t));
    return;
  }
  await sendText(c.to, r.answer.replace(/\*\*/g, '*'));
}

const MAX_ROWS = 25;

/** Tabela → mensagem de WhatsApp legível (título, uma linha por item, total). */
function formatTable(t: Extract<Card, { type: 'table' }>): string {
  const col = (name: string) => t.columns.findIndex((x) => normalize(x) === normalize(name));
  const iSku = col('SKU');
  const iName = col('Produto');
  const iAvail = col('Disponível');
  const iPhys = col('Físico');
  const iStatus = col('Situação');
  const v = (row: (string | number | null)[], i: number) => (i >= 0 && row[i] !== null && row[i] !== undefined && row[i] !== '' ? row[i] : null);
  const num = (x: string | number | null) => (typeof x === 'number' ? fmt(x) : x);
  const lines = t.rows.slice(0, MAX_ROWS).map((row) => {
    if (iAvail >= 0 && iName >= 0) {
      // lista de produtos
      const avail = Number(v(row, iAvail) ?? 0);
      const icon = avail > 0 ? '🟢' : '⚪';
      const unconfirmed = iStatus >= 0 && String(v(row, iStatus) ?? '').startsWith('Não') ? ' ⚠️' : '';
      return `${icon} *${v(row, iSku) ?? '—'}* · ${v(row, iName)}\n      Disponível: *${num(v(row, iAvail))}*${v(row, iPhys) !== null ? ` · Físico ${num(v(row, iPhys))}` : ''}${unconfirmed}`;
    }
    // genérico: primeira coluna em destaque, demais como "Coluna: valor"
    const [first, ...rest] = row;
    const extras = rest.map((x, k) => (x === null || x === '' ? null : `${t.columns[k + 1]}: ${num(x)}`)).filter(Boolean);
    return `▸ *${num(first) ?? '—'}*${extras.length ? `\n      ${extras.join(' · ')}` : ''}`;
  });
  const more = t.rows.length > MAX_ROWS
    ? `\n\n…e mais ${fmt(t.rows.length - MAX_ROWS)}. Para ver um item, envie o SKU ou o nome.`
    : '\n\nPara ver um item, envie o SKU ou o nome.';
  const legend = iAvail >= 0 ? '\n🟢 com saldo · ⚪ sem saldo · ⚠️ não confirmado' : '';
  return `📋 *${t.title}*${t.rows.length > 1 ? ` (${fmt(t.rows.length)})` : ''}\n\n${lines.join('\n')}${more}${legend}`;
}

function productButtons(productId: number, available: number): Button[] {
  return available > 0
    ? [{ id: `r:${productId}`, title: '📌 Reservar' }, { id: `c:${productId}`, title: '🛒 Solicitar compra' }, { id: 'm:menu', title: 'Menu' }]
    : [{ id: `c:${productId}`, title: '🛒 Solicitar compra' }, { id: 'm:consultar', title: '🔎 Outro produto' }, { id: 'm:menu', title: 'Menu' }];
}

// ---------------------------------------------------------------- produto

async function showProduct(c: Ctx, productId: number, sale: { requested: number; possible: boolean | null; shortfall: number; remainingAfterSale: number | null } | null = null) {
  const r = await getAvailability(productId, { viewer: viewer(c.user) });
  if (!r) {
    await sendText(c.to, 'Produto não encontrado.');
    return;
  }
  c.session.lastProductId = productId;
  const avail = r.kit ? r.kit.availableForSale : r.availableForSale;
  const unit = r.product.unit ? ` ${r.product.unit}` : '';
  const d = r.deductions;
  const verdict = !sale
    ? []
    : sale.possible === false || (sale.possible === null && avail <= 0)
      ? [`❌ *Não dá para vender ${fmt(sale.requested)}${unit}.*`, avail > 0 ? `Faltam ${fmt(sale.shortfall)}${unit}.` : 'Não há saldo livre para nova venda.', '']
      : sale.possible === true
      ? [`✅ *Pode vender ${fmt(sale.requested)}${unit}!*`, `Depois da venda restam ${fmt(sale.remainingAfterSale)}${unit}.`, '']
      : sale.possible === false
        ? [`❌ *Não dá para vender ${fmt(sale.requested)}${unit}.*`, `Faltam ${fmt(sale.shortfall)}${unit}.`, '']
        : [`⚠️ *Não consigo confirmar a venda de ${fmt(sale.requested)}${unit}* — veja os avisos abaixo.`, ''];
  const lines = [
    ...verdict,
    `📦 *${r.product.sku ?? 'sem SKU'}*`,
    r.product.name,
    '',
    avail > 0 ? `✅ *Disponível para venda: ${fmt(avail)}${unit}*` : `⛔ *Sem saldo para nova venda* (0${unit})`,
    '',
    `▫️ Estoque físico: ${fmt(r.physicalTotal)}`,
  ];
  if (d.committedOrders) lines.push(`▫️ Pedidos ainda sem baixa: −${fmt(d.committedOrders)}`);
  if (d.preOrderReservations) lines.push(`▫️ Pré-pedidos com reserva: −${fmt(d.preOrderReservations)}`);
  if (d.localReservations) lines.push(`▫️ Reservas: −${fmt(d.localReservations)}`);
  if (d.blocked) lines.push(`▫️ Bloqueios: −${fmt(d.blocked)}`);
  if (d.uncertain) lines.push(`▫️ Incertos (por precaução): −${fmt(d.uncertain)}`);
  if (r.kit) lines.push(`Kit montado pelos componentes.`);
  if (r.status !== 'CONFIRMED') {
    lines.push('', '⚠️ *Disponibilidade não confirmada* — confirme com o gestor antes de prometer ao cliente:');
    for (const msg of [...new Set(r.issues.filter((x) => x.severity !== 'info').map((x) => x.message))].slice(0, 3)) lines.push(`• ${msg}`);
  }
  if (r.incoming.length) {
    lines.push('', `🚚 A chegar (ainda não conta no disponível): ${r.incoming.map((e) => `${fmt(e.quantity)}${e.expectedDate ? ` em ${brDate(e.expectedDate)}` : ''}`).join(', ')}`);
  }
  if (r.dataSource === 'demo') lines.push('', '_Ambiente de demonstração — dados fictícios._');
  lines.push('', `🕒 _Atualizado em ${brDateTime(r.dataAsOf) ?? 'agora'}_`);
  await sendButtons(c.to, lines.join('\n'), productButtons(productId, avail));
}

// ---------------------------------------------------------------- escolhas (botões e menus)

async function onChoice(c: Ctx, id: string) {
  const [kind, arg, arg2] = id.split(':');
  const s = c.session;
  switch (kind) {
    case 'm':
      clearFlow(s);
      switch (arg) {
        case 'menu':
          return sendMenu(c);
        case 'consultar':
          await sendText(c.to, 'Qual produto? Escreva o *SKU* ou parte do *nome*. 🔎');
          return;
        case 'disponiveis':
          return askAssistant(c, 'Quais produtos estão disponíveis para venda?');
        case 'sem_estoque':
          return askAssistant(c, 'O que está sem estoque?');
        case 'pedidos':
          return askAssistant(c, 'Quais pedidos em aberto estão prendendo estoque?');
        case 'reservar':
          return startReserve(c, '');
        case 'minhas_reservas':
          return myReservations(c);
        case 'compra':
          return startPurchase(c, '');
        case 'minhas_compras':
          return myPurchases(c);
        case 'aprovar':
          return pendingApprovals(c);
        case 'compras_abertas':
          return openPurchases(c);
      }
      return sendMenu(c);
    case 'p':
    case 'fp': // produto escolhido numa lista (fora de um fluxo em andamento)
      clearFlow(s);
      return showProduct(c, Number(arg));
    case 'r':
      return startReserve(c, '', Number(arg));
    case 'c':
      return startPurchase(c, '', Number(arg));
    case 'ok':
      return confirmFlow(c);
    case 'no':
      clearFlow(s);
      await sendText(c.to, 'Cancelado. Nada foi registrado. Digite *menu* quando quiser.');
      return;
    case 'res':
      return showReservation(c, arg);
    case 'rr':
      setFlow(s, { flow: 'renew', reservationId: arg });
      await sendButtons(c.to, 'Renovar a reserva por quanto tempo?', [
        { id: `rh:${arg}:24`, title: '24 horas' },
        { id: `rh:${arg}:48`, title: '48 horas' },
        { id: `rh:${arg}:72`, title: '72 horas' },
      ]);
      return;
    case 'rh':
      clearFlow(s);
      return doReservation(c, () => renewReservation(arg, Number(arg2), viewer(c.user)), `Reserva renovada por ${arg2} horas. ✅`);
    case 'rc':
      await sendButtons(c.to, 'Confirma o *cancelamento* desta reserva? As unidades voltam para o disponível.', [
        { id: `rcx:${arg}`, title: 'Sim, cancelar' },
        { id: 'm:minhas_reservas', title: 'Não' },
      ]);
      return;
    case 'rcx':
      return doReservation(c, () => changeReservationStatus(arg, 'cancel', viewer(c.user), 'Cancelada pelo WhatsApp'), 'Reserva cancelada. As unidades voltaram para o disponível.');
    case 'ra':
      if (!isManager(c)) return;
      return doReservation(c, async () => {
        await approveReservation(arg, viewer(c.user));
        const { rows } = await pool.query('SELECT seller_user_id, quantity, customer_name FROM reservations WHERE id = $1', [arg]);
        if (rows[0]) await notifyUsers([rows[0].seller_user_id], `✅ Sua reserva de ${fmt(rows[0].quantity)} un. para *${rows[0].customer_name}* foi *aprovada*.`);
      }, 'Reserva aprovada. ✅ O vendedor foi avisado.');
    case 'rj':
      if (!isManager(c)) return;
      setFlow(s, { flow: 'reject', reservationId: arg });
      await sendText(c.to, 'Qual o motivo da recusa? (o vendedor verá esta mensagem)');
      return;
    case 'pr':
      return showPurchase(c, Number(arg));
    case 'ps':
      return askPurchaseNote(c, arg, arg2 as PurchaseStatus);
  }
  await sendMenu(c);
}

// ---------------------------------------------------------------- reservas

async function startReserve(c: Ctx, text: string, productId?: number) {
  const s = c.session;
  let rest = text.trim();
  let qty: number | undefined;
  let customer: string | undefined;
  // "reservar 5 OSTT-061860 para Construtora Alfa"
  const m = rest.match(/^(\d+(?:[.,]\d+)?)\s*(?:un(?:idades?)?|p[cç]s?|pe[cç]as?|x)?\s+(?:do |da |de )?(.+)$/i);
  if (m) {
    qty = Number(m[1].replace(',', '.'));
    rest = m[2];
  }
  const p = rest.match(/^(.*?)\s+(?:para|pra|p\/)\s+(?:o cliente |a cliente |cliente )?(.+)$/i);
  if (p) {
    rest = p[1];
    customer = p[2].trim();
  }
  const flow: Extract<Flow, { flow: 'reserve' }> = { flow: 'reserve', step: 'product', qty, customer };
  if (productId) {
    await setReserveProduct(c, flow, productId);
    return;
  }
  if (rest) {
    const ok = await resolveInto(c, rest, async (id) => setReserveProduct(c, flow, id), flow);
    if (ok) return;
    setFlow(s, flow);
    await sendText(c.to, `Não encontrei o produto "${rest}". Escreva o *SKU* ou outra parte do *nome* (ou *cancelar*).`);
    return;
  }
  setFlow(s, flow);
  await sendText(c.to, '📌 *Nova reserva*\nQual produto? Escreva o *SKU* ou parte do *nome*.\n\n_(Digite *cancelar* para desistir.)_');
}

/** Resolve um produto pelo texto; se ambíguo, mostra a lista e guarda o fluxo esperando a escolha. */
async function resolveInto(c: Ctx, text: string, onFound: (id: number) => Promise<void>, flow: Flow): Promise<boolean> {
  const res = await resolveProduct(text, { viewer: viewer(c.user), cards: [], lastProductId: c.session.lastProductId });
  if ('product' in res) {
    await onFound(res.product.id);
    return true;
  }
  if ('ambiguous' in res) {
    setFlow(c.session, { ...flow, step: 'product' } as Flow);
    await sendList(
      c.to,
      'Encontrei mais de um produto. Qual deles?',
      'Escolher produto',
      res.ambiguous.slice(0, 10).map((p) => ({ id: `fp:${p.id}`, title: p.sku ?? p.name, description: p.name })),
      'Produtos',
    );
    return true;
  }
  return false;
}

async function setReserveProduct(c: Ctx, flow: Extract<Flow, { flow: 'reserve' }>, productId: number) {
  const r = await getAvailability(productId, { viewer: viewer(c.user) });
  if (!r) {
    await sendText(c.to, 'Produto não encontrado.');
    return;
  }
  const available = r.kit ? r.kit.availableForSale : r.availableForSale;
  const next: Extract<Flow, { flow: 'reserve' }> = {
    ...flow,
    productId,
    productLabel: `${r.product.sku ? `${r.product.sku} — ` : ''}${r.product.name}`,
    available,
    unit: r.product.unit ?? null,
  };
  c.session.lastProductId = productId;
  if (available <= 0) {
    clearFlow(c.session);
    await sendButtons(c.to, `⛔ *${next.productLabel}* está sem saldo para nova venda, então não dá para reservar agora.\n\nQuer pedir a compra?`, [
      { id: `c:${productId}`, title: '🛒 Solicitar compra' },
      { id: 'm:menu', title: 'Menu' },
    ]);
    return;
  }
  return advanceReserve(c, next);
}

async function advanceReserve(c: Ctx, f: Extract<Flow, { flow: 'reserve' }>) {
  const unit = f.unit ? ` ${f.unit}` : '';
  if (!f.qty) {
    setFlow(c.session, { ...f, step: 'qty' });
    await sendText(c.to, `*${f.productLabel}*\nDisponível para venda: *${fmt(f.available)}${unit}*\n\nQuantas unidades quer reservar?`);
    return;
  }
  if (!f.customer) {
    setFlow(c.session, { ...f, step: 'customer' });
    await sendText(c.to, 'Para qual *cliente* é a reserva?');
    return;
  }
  setFlow(c.session, { ...f, step: 'confirm' });
  const warn = f.qty > (f.available ?? 0) ? `\n\n⚠️ A quantidade é maior que o disponível (${fmt(f.available)}). A reserva pode ser recusada.` : '';
  await sendButtons(
    c.to,
    `Confira a reserva:\n\n📦 ${f.productLabel}\n🔢 Quantidade: *${fmt(f.qty)}${unit}*\n👤 Cliente: *${f.customer}*${warn}`,
    [{ id: 'ok', title: '✅ Confirmar' }, { id: 'no', title: 'Cancelar' }],
  );
}

// ---------------------------------------------------------------- solicitação de compra

async function startPurchase(c: Ctx, text: string, productId?: number) {
  const flow: Extract<Flow, { flow: 'purchase' }> = { flow: 'purchase', step: 'product' };
  if (productId) return setPurchaseProduct(c, flow, productId);
  const rest = text.trim();
  if (rest) {
    const m = rest.match(/^(\d+(?:[.,]\d+)?)\s*(?:un(?:idades?)?|p[cç]s?|pe[cç]as?|x)?\s+(?:do |da |de )?(.+)$/i);
    const f = m ? { ...flow, qty: Number(m[1].replace(',', '.')) } : flow;
    const term = m ? m[2] : rest;
    const ok = await resolveInto(c, term, async (id) => setPurchaseProduct(c, f, id), f);
    if (ok) return;
    // produto fora do catálogo: aceita o texto como descrição
    return advancePurchase(c, { ...f, productId: null, productLabel: term });
  }
  setFlow(c.session, flow);
  await sendText(c.to, '🛒 *Solicitação de compra*\nQual produto precisa ser comprado? Escreva o *SKU* ou o *nome* (pode ser um produto que ainda não existe no cadastro).\n\n_(Digite *cancelar* para desistir.)_');
}

async function setPurchaseProduct(c: Ctx, flow: Extract<Flow, { flow: 'purchase' }>, productId: number) {
  const { rows } = await pool.query('SELECT sku, name FROM products WHERE id = $1', [productId]);
  if (!rows[0]) {
    await sendText(c.to, 'Produto não encontrado.');
    return;
  }
  c.session.lastProductId = productId;
  return advancePurchase(c, { ...flow, productId, productLabel: `${rows[0].sku ? `${rows[0].sku} — ` : ''}${rows[0].name}` });
}

async function advancePurchase(c: Ctx, f: Extract<Flow, { flow: 'purchase' }>) {
  if (!f.qty) {
    setFlow(c.session, { ...f, step: 'qty' });
    await sendText(c.to, `*${f.productLabel}*\nQuantas unidades precisam ser compradas?`);
    return;
  }
  if (f.customer === undefined) {
    setFlow(c.session, { ...f, step: 'customer' });
    await sendButtons(c.to, 'É para algum *cliente*? Escreva o nome ou toque em "Sem cliente".', [{ id: 'skip', title: 'Sem cliente' }]);
    return;
  }
  if (f.notes === undefined) {
    setFlow(c.session, { ...f, step: 'notes' });
    await sendButtons(c.to, 'Alguma *observação* para o comprador (prazo, cor, marca…)? Escreva ou toque em "Sem observação".', [{ id: 'skip', title: 'Sem observação' }]);
    return;
  }
  setFlow(c.session, { ...f, step: 'confirm' });
  await sendButtons(
    c.to,
    `Confira a solicitação de compra:\n\n📦 ${f.productLabel}${f.productId ? '' : ' _(fora do cadastro)_'}\n🔢 Quantidade: *${fmt(f.qty)}*\n👤 Cliente: ${f.customer ?? '—'}\n📝 Observação: ${f.notes ?? '—'}`,
    [{ id: 'ok', title: '✅ Enviar' }, { id: 'no', title: 'Cancelar' }],
  );
}

// ---------------------------------------------------------------- continuação dos fluxos (texto)

const parseQty = (t: string) => {
  const m = t.replace(/\s/g, '').match(/^(\d+(?:[.,]\d+)?)/);
  const n = m ? Number(m[1].replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? n : null;
};

async function continueFlow(c: Ctx, raw: string) {
  const st = c.session.state as Flow & { at: number };
  switch (st.flow) {
    case 'reserve': {
      if (st.step === 'product') {
        const ok = await resolveInto(c, raw, async (id) => setReserveProduct(c, st, id), st);
        if (!ok) await sendText(c.to, `Não encontrei "${raw}". Tente o SKU ou outra parte do nome (ou *cancelar*).`);
        return;
      }
      if (st.step === 'qty') {
        const q = parseQty(raw);
        if (!q) return void (await sendText(c.to, 'Não entendi a quantidade. Envie só o número, ex.: *5*'));
        return advanceReserve(c, { ...st, qty: q });
      }
      if (st.step === 'customer') {
        if (raw.trim().length < 2) return void (await sendText(c.to, 'Informe o nome do cliente.'));
        return advanceReserve(c, { ...st, customer: raw.trim().slice(0, 120) });
      }
      return confirmFlow(c, raw);
    }
    case 'purchase': {
      if (st.step === 'product') {
        const ok = await resolveInto(c, raw, async (id) => setPurchaseProduct(c, st, id), st);
        if (!ok) return advancePurchase(c, { ...st, productId: null, productLabel: raw.trim().slice(0, 300) });
        return;
      }
      if (st.step === 'qty') {
        const q = parseQty(raw);
        if (!q) return void (await sendText(c.to, 'Não entendi a quantidade. Envie só o número, ex.: *10*'));
        return advancePurchase(c, { ...st, qty: q });
      }
      if (st.step === 'customer') return advancePurchase(c, { ...st, customer: /^(nao|não|sem|-|pular|nenhum)\b/i.test(raw.trim()) ? null : raw.trim().slice(0, 120) });
      if (st.step === 'notes') return advancePurchase(c, { ...st, notes: /^(nao|não|sem|-|pular|nenhuma)\b/i.test(raw.trim()) ? null : raw.trim().slice(0, 500) });
      return confirmFlow(c, raw);
    }
    case 'reject': {
      clearFlow(c.session);
      return doReservation(c, async () => {
        await changeReservationStatus(st.reservationId, 'reject', viewer(c.user), raw.slice(0, 300));
        const { rows } = await pool.query('SELECT seller_user_id, quantity, customer_name FROM reservations WHERE id = $1', [st.reservationId]);
        if (rows[0]) await notifyUsers([rows[0].seller_user_id], `❌ Sua reserva de ${fmt(rows[0].quantity)} un. para *${rows[0].customer_name}* foi *recusada*.\nMotivo: ${raw.slice(0, 300)}`);
      }, 'Reserva recusada. O vendedor foi avisado.');
    }
    case 'pr_note': {
      clearFlow(c.session);
      const note = /^(nao|não|sem|-|pular)\b/i.test(raw.trim()) ? null : raw.trim().slice(0, 500);
      return doPurchaseUpdate(c, st.prId, st.status, note);
    }
    case 'renew':
      clearFlow(c.session);
      return sendMenu(c);
  }
}

/** Confirma o fluxo atual (botão "Confirmar" ou texto "sim"). */
async function confirmFlow(c: Ctx, raw?: string) {
  const st = c.session.state as (Flow & { at: number }) | Record<string, never>;
  if (raw !== undefined && !/^(sim|s|ok|confirmar|confirmo|enviar|isso)\b/i.test(normalize(raw))) {
    await sendText(c.to, 'Responda *sim* para confirmar ou *cancelar* para desistir.');
    return;
  }
  if (!('flow' in st)) return sendMenu(c);
  if (st.flow === 'reserve' && st.step === 'confirm' && st.productId && st.qty && st.customer) {
    clearFlow(c.session);
    try {
      const { reservation, note } = await createReservation(
        { productId: st.productId, quantity: st.qty, customerName: st.customer, reason: 'Solicitada pelo WhatsApp' },
        viewer(c.user),
      );
      await audit({ userId: c.user.id, action: 'whatsapp.reservation', entity: 'reservation', entityId: reservation.id });
      if (reservation.status === 'ACTIVE') {
        await sendButtons(c.to, `✅ *Reserva ativa!*\n${fmt(st.qty)} × ${st.productLabel}\nCliente: ${st.customer}\nVálida até ${brDateTime(reservation.expires_at)}.`, [
          { id: 'm:minhas_reservas', title: '📋 Minhas reservas' },
          { id: 'm:menu', title: 'Menu' },
        ]);
      } else {
        await sendButtons(c.to, `🕓 *Reserva enviada para aprovação do gestor.*\n${fmt(st.qty)} × ${st.productLabel}\nCliente: ${st.customer}${note ? `\n${note}` : ''}\nVocê recebe uma mensagem aqui quando for aprovada.`, [
          { id: 'm:minhas_reservas', title: '📋 Minhas reservas' },
          { id: 'm:menu', title: 'Menu' },
        ]);
        const { rows } = await pool.query("SELECT id FROM users WHERE active AND role IN ('gestor', 'admin') AND whatsapp_phone IS NOT NULL");
        await notifyUsers(rows.map((r) => r.id), `📌 *Reserva aguardando aprovação*\n${fmt(st.qty)} × ${st.productLabel}\nVendedor: ${c.user.name}\n\nPara aprovar, abra o menu e toque em *Reservas p/ aprovar*.`);
      }
    } catch (err) {
      await sendText(c.to, `Não foi possível reservar: ${humanize((err as Error).message)}`);
    }
    return;
  }
  if (st.flow === 'purchase' && st.step === 'confirm' && st.qty && st.productLabel) {
    clearFlow(c.session);
    try {
      const pr = await createPurchaseRequest(
        { productId: st.productId ?? null, productText: st.productLabel, quantity: st.qty, customerName: st.customer ?? null, notes: st.notes ?? null },
        viewer(c.user),
        'whatsapp',
      );
      await sendButtons(c.to, `✅ *Solicitação de compra #${pr.number} enviada!*\nO gestor foi avisado. Você recebe uma mensagem aqui quando ela andar.`, [
        { id: 'm:minhas_compras', title: '🧾 Minhas compras' },
        { id: 'm:menu', title: 'Menu' },
      ]);
    } catch (err) {
      await sendText(c.to, `Não foi possível registrar: ${(err as Error).message}`);
    }
    return;
  }
  await sendMenu(c);
}

// ---------------------------------------------------------------- listas e detalhes

async function myReservations(c: Ctx) {
  clearFlow(c.session);
  const all = await listReservations({ sellerUserId: c.user.id }, viewer(c.user));
  const open = all.filter((r: { status: string }) => ['PENDING', 'ACTIVE', 'EXPIRED'].includes(r.status));
  if (!open.length) {
    await sendButtons(c.to, 'Você não tem reservas em aberto.', [{ id: 'm:reservar', title: '📌 Fazer reserva' }, { id: 'm:menu', title: 'Menu' }]);
    return;
  }
  await sendList(
    c.to,
    `📋 *Suas reservas em aberto* (${open.length})\nToque para ver, renovar ou cancelar.`,
    'Ver reservas',
    open.slice(0, 10).map((r: any) => ({
      id: `res:${r.id}`,
      title: `${fmt(r.quantity)} × ${r.sku ?? r.product_name}`,
      description: `${r.customer_name} · ${RES_STATUS[r.status] ?? r.status} · vence ${brDateTime(r.expires_at)}`,
    })),
    'Reservas',
  );
}

async function showReservation(c: Ctx, id: string) {
  const all = await listReservations({}, viewer(c.user));
  const r = all.find((x: { id: string }) => x.id === id);
  if (!r || (!isManager(c) && r.seller_user_id !== c.user.id)) {
    await sendText(c.to, 'Reserva não encontrada.');
    return;
  }
  const text = `📌 *Reserva*\n📦 ${r.sku ? `${r.sku} — ` : ''}${r.product_name}\n🔢 ${fmt(r.quantity)} un.\n👤 ${r.customer_name}\n${isManager(c) ? `🧑‍💼 Vendedor: ${r.seller_name}\n` : ''}📍 ${RES_STATUS[r.status] ?? r.status}\n⏰ Vence: ${brDateTime(r.expires_at)}`;
  const buttons: Button[] = [];
  if (isManager(c) && r.status === 'PENDING') {
    buttons.push({ id: `ra:${r.id}`, title: '✅ Aprovar' }, { id: `rj:${r.id}`, title: '❌ Recusar' });
  } else if (r.status === 'ACTIVE' || (isManager(c) && r.status === 'EXPIRED')) {
    buttons.push({ id: `rr:${r.id}`, title: '🔁 Renovar' });
  }
  if (['PENDING', 'ACTIVE', 'EXPIRED'].includes(r.status) && buttons.length < 3) buttons.push({ id: `rc:${r.id}`, title: '🗑️ Cancelar' });
  if (buttons.length < 3) buttons.push({ id: 'm:menu', title: 'Menu' });
  await sendButtons(c.to, text, buttons);
}

async function doReservation(c: Ctx, fn: () => Promise<unknown>, okText: string) {
  try {
    await fn();
    await sendButtons(c.to, okText, [{ id: isManager(c) ? 'm:aprovar' : 'm:minhas_reservas', title: isManager(c) ? '✔️ Reservas p/ aprovar' : '📋 Minhas reservas' }, { id: 'm:menu', title: 'Menu' }]);
  } catch (err) {
    await sendText(c.to, `Não foi possível: ${humanize((err as Error).message)}`);
  }
}

async function pendingApprovals(c: Ctx) {
  if (!isManager(c)) return sendMenu(c);
  const pending = await listReservations({ status: 'PENDING' }, viewer(c.user));
  if (!pending.length) {
    await sendText(c.to, 'Nenhuma reserva aguardando aprovação. ✅');
    return;
  }
  await sendList(
    c.to,
    `✔️ *Reservas aguardando aprovação* (${pending.length})`,
    'Ver reservas',
    pending.slice(0, 10).map((r: any) => ({ id: `res:${r.id}`, title: `${fmt(r.quantity)} × ${r.sku ?? r.product_name}`, description: `${r.seller_name} · ${r.customer_name}` })),
    'Pendentes',
  );
}

async function myPurchases(c: Ctx) {
  clearFlow(c.session);
  const rows = (await listPurchaseRequests(viewer(c.user))).filter((r: { requested_by: string }) => r.requested_by === c.user.id);
  if (!rows.length) {
    await sendButtons(c.to, 'Você ainda não fez solicitações de compra.', [{ id: 'm:compra', title: '🛒 Solicitar compra' }, { id: 'm:menu', title: 'Menu' }]);
    return;
  }
  await sendList(
    c.to,
    '🧾 *Suas solicitações de compra*',
    'Ver solicitações',
    rows.slice(0, 10).map((r: any) => ({ id: `pr:${r.number}`, title: `#${r.number} · ${fmt(r.quantity)} un.`, description: `${PURCHASE_STATUS_LABEL[r.status as PurchaseStatus]} · ${r.product_text}` })),
    'Solicitações',
  );
}

async function openPurchases(c: Ctx) {
  if (!isManager(c)) return sendMenu(c);
  const rows = (await listPurchaseRequests(viewer(c.user))).filter((r: { status: string }) => r.status === 'OPEN' || r.status === 'ORDERED');
  if (!rows.length) {
    await sendText(c.to, 'Nenhuma solicitação de compra em aberto. ✅');
    return;
  }
  await sendList(
    c.to,
    `🛍️ *Solicitações de compra em aberto* (${rows.length})`,
    'Ver solicitações',
    rows.slice(0, 10).map((r: any) => ({ id: `pr:${r.number}`, title: `#${r.number} · ${fmt(r.quantity)} un.`, description: `${PURCHASE_STATUS_LABEL[r.status as PurchaseStatus]} · ${r.requested_by_name} · ${r.product_text}` })),
    'Solicitações',
  );
}

async function showPurchase(c: Ctx, number: number) {
  let pr;
  try {
    pr = await getPurchaseRequest({ number }, viewer(c.user));
  } catch {
    await sendText(c.to, `Solicitação #${number} não encontrada.`);
    return;
  }
  const text = `🧾 *Solicitação de compra #${pr.number}*\n📦 ${pr.product_text}\n🔢 ${fmt(pr.quantity)} un.\n👤 Cliente: ${pr.customer_name ?? '—'}\n📝 ${pr.notes ?? 'Sem observação'}\n🧑‍💼 Pedida por: ${pr.requested_by_name} em ${brDateTime(pr.created_at)}\n📍 *${PURCHASE_STATUS_LABEL[pr.status as PurchaseStatus]}*${pr.manager_note ? `\nObs. do gestor: ${pr.manager_note}` : ''}`;
  const buttons: Button[] = [];
  if (isManager(c) && (pr.status === 'OPEN' || pr.status === 'ORDERED')) {
    if (pr.status === 'OPEN') buttons.push({ id: `ps:${pr.id}:ORDERED`, title: '🛒 Comprado' });
    buttons.push({ id: `ps:${pr.id}:RECEIVED`, title: '📦 Recebido' });
    if (pr.status === 'OPEN') buttons.push({ id: `ps:${pr.id}:REJECTED`, title: '❌ Recusar' });
  } else if (pr.requested_by === c.user.id && pr.status === 'OPEN') {
    buttons.push({ id: `ps:${pr.id}:CANCELLED`, title: '🗑️ Cancelar' });
  }
  if (buttons.length < 3) buttons.push({ id: 'm:menu', title: 'Menu' });
  await sendButtons(c.to, text, buttons);
}

async function askPurchaseNote(c: Ctx, prId: string, status: PurchaseStatus) {
  if (status === 'CANCELLED') return doPurchaseUpdate(c, prId, status, null);
  setFlow(c.session, { flow: 'pr_note', prId, status });
  await sendButtons(
    c.to,
    `Vai marcar como *${PURCHASE_STATUS_LABEL[status]}*. Quer deixar uma observação para o vendedor (ex.: previsão de chegada)?`,
    [{ id: 'skip', title: 'Sem observação' }],
  );
}

async function doPurchaseUpdate(c: Ctx, prId: string, status: PurchaseStatus, note: string | null) {
  try {
    const pr = await updatePurchaseRequest(prId, status, viewer(c.user), note);
    await sendButtons(c.to, `Solicitação #${pr.number} marcada como *${PURCHASE_STATUS_LABEL[status]}*.${status !== 'CANCELLED' ? ' O vendedor foi avisado.' : ''}`, [
      { id: isManager(c) ? 'm:compras_abertas' : 'm:minhas_compras', title: isManager(c) ? '🛍️ Compras abertas' : '🧾 Minhas compras' },
      { id: 'm:menu', title: 'Menu' },
    ]);
  } catch (err) {
    await sendText(c.to, `Não foi possível: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------- "skip" e escolha de produto dentro de um fluxo

/** Botões que só fazem sentido dentro de um fluxo: "Sem cliente/observação" e produto escolhido da lista. */
async function routeFlowButton(c: Ctx, id: string): Promise<boolean> {
  const st = c.session.state as Flow & { at: number };
  if (!('flow' in st)) return false;
  if (id === 'skip') {
    if (st.flow === 'purchase' && st.step === 'customer') await advancePurchase(c, { ...st, customer: null });
    else if (st.flow === 'purchase' && st.step === 'notes') await advancePurchase(c, { ...st, notes: null });
    else if (st.flow === 'pr_note') {
      clearFlow(c.session);
      await doPurchaseUpdate(c, st.prId, st.status, null);
    } else return false;
    return true;
  }
  if (id.startsWith('fp:')) {
    const pid = Number(id.slice(3));
    if (st.flow === 'reserve') await setReserveProduct(c, st, pid);
    else if (st.flow === 'purchase') await setPurchaseProduct(c, st, pid);
    else return false;
    return true;
  }
  return false;
}
