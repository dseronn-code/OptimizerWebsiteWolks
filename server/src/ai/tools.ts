import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { checkSale } from '../engine/availability.js';
import type { ExplanationLine } from '../engine/types.js';
import { getSettings } from '../lib/settings.js';
import { normalize } from '../lib/text.js';
import { upsertAlert } from '../alerts/alertService.js';
import { searchProducts, type ProductMatch } from '../stock/productSearch.js';
import { canSeeCustomer, getAvailability, type AvailabilityResponse, type Viewer } from '../stock/stockService.js';

/**
 * Ferramentas de consulta disponibilizadas à IA.
 * Todas são SOMENTE LEITURA, executadas no backend com o perfil do usuário logado,
 * e todos os números vêm do motor determinístico — a IA apenas escolhe a ferramenta e explica.
 */

export interface ToolContext {
  viewer: Viewer;
  /** Cartões estruturados exibidos pela interface ao lado da resposta. */
  cards: Card[];
  /** Último produto consultado (para perguntas como "desse produto"). */
  lastProductId: number | null;
}

export type Card =
  | { type: 'availability'; data: AvailabilityResponse; sale?: ReturnType<typeof checkSale> }
  | { type: 'candidates'; data: ProductMatch[] }
  | { type: 'table'; title: string; columns: string[]; rows: (string | number | null)[][] };

const productRef = z.string().min(1).max(120).describe('SKU, código, nome (mesmo incompleto ou com erro de digitação) ou id do produto');

export const toolSchemas = {
  buscar_produto: z.object({ termo: productRef }),
  consultar_disponibilidade: z.object({ produto: productRef, deposito: z.string().max(80).optional() }),
  verificar_venda: z.object({ produto: productRef, quantidade: z.number().positive(), deposito: z.string().max(80).optional() }),
  compromissos_do_produto: z.object({ produto: productRef }),
  reservas_do_cliente: z.object({ cliente: z.string().min(2).max(120) }),
  pedidos_por_situacao: z.object({
    situacao: z.string().min(2).max(80).describe('Nome (ou parte) da situação no Bling, ex.: "aguardando transportadora", ou categoria: confirmados, pre-pedidos, cotacoes'),
  }),
  produtos_com_divergencia: z.object({}),
  reservas_vencendo: z.object({ horas: z.number().positive().max(24 * 30).optional() }),
  entradas_previstas: z.object({ produto: productRef.optional(), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Data limite AAAA-MM-DD') }),
  simular_cancelamento: z.object({ pedido: z.number().int().positive().describe('Número do pedido no Bling'), produto: productRef.optional() }),
  listar_produtos: z.object({
    filtro: z.enum(['disponiveis', 'sem_estoque', 'nao_confirmados', 'todos']).optional().describe('disponiveis (padrão): com saldo para venda; sem_estoque: zerados; nao_confirmados: com aviso; todos'),
    busca: z.string().max(80).optional().describe('Parte do nome/SKU ou categoria para filtrar (opcional)'),
    limite: z.number().int().positive().max(100).optional(),
  }),
  status_sincronizacao: z.object({}),
} as const;

export type ToolName = keyof typeof toolSchemas;

export const toolDescriptions: Record<ToolName, string> = {
  buscar_produto: 'Localiza produtos por SKU/nome tolerando erros de digitação. Use quando o produto citado for ambíguo.',
  consultar_disponibilidade:
    'Calcula a disponibilidade efetiva de um produto: estoque físico, virtual, compromissos (pedidos pagos, pré-pedidos, reservas, bloqueios), disponível para nova venda, visão por depósito, atualidade dos dados e avisos.',
  verificar_venda: 'Verifica se é possível vender uma quantidade de um produto agora, com o saldo restante após a venda. Atualiza o saldo no Bling se estiver desatualizado.',
  compromissos_do_produto: 'Lista pedidos, reservas e bloqueios que prendem o estoque de um produto e como cada um entrou no cálculo (quem, quanto, situação).',
  reservas_do_cliente: 'Lista reservas e pedidos em aberto de um cliente.',
  pedidos_por_situacao: 'Lista pedidos de venda em aberto filtrados por situação do Bling ou categoria comercial.',
  produtos_com_divergencia: 'Lista produtos com divergências: saldo negativo, compromissos acima do saldo, possível desconto duplicado, situação sem regra.',
  reservas_vencendo: 'Lista reservas que vencem nas próximas horas e reservas já vencidas.',
  entradas_previstas: 'Lista entradas previstas (pedidos de compra em aberto), opcionalmente de um produto e até uma data. Entradas não aumentam a disponibilidade atual.',
  simular_cancelamento: 'Simula quanto ficaria disponível se um pedido fosse cancelado (não altera nada).',
  listar_produtos: 'Lista vários produtos com o disponível para venda de cada um (ex.: "quais produtos temos disponíveis?", "o que está sem estoque?"). Ordena do maior para o menor disponível.',
  status_sincronizacao: 'Informa a última sincronização com o Bling e falhas recentes.',
};

type ResolveResult = { product: ProductMatch } | { ambiguous: ProductMatch[] } | { notFound: true };

export async function resolveProduct(ref: string, ctx: ToolContext): Promise<ResolveResult> {
  const trimmed = ref.trim();
  if (/^(esse|este|desse|deste|mesmo)\b/i.test(trimmed) && ctx.lastProductId) {
    const { rows } = await pool.query('SELECT id, sku, name, format, active FROM products WHERE id = $1', [ctx.lastProductId]);
    if (rows[0]) return { product: { ...rows[0], score: 1 } };
  }
  if (/^\d+$/.test(trimmed)) {
    const { rows } = await pool.query('SELECT id, sku, name, format, active FROM products WHERE id = $1 OR lower(sku) = lower($2) LIMIT 2', [Number(trimmed), trimmed]);
    if (rows.length === 1) return { product: { ...rows[0], score: 1 } };
  }
  const matches = await searchProducts(trimmed, 6);
  if (matches.length === 0) return { notFound: true };
  const [first, second] = matches;
  if (first.score >= 0.9 && (!second || first.score - second.score >= 0.08)) return { product: first };
  if (matches.length === 1 && first.score >= 0.6) return { product: first };
  return { ambiguous: matches };
}

function localTime(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('pt-BR', { timeZone: config.APP_TIMEZONE, dateStyle: 'short', timeStyle: 'short' });
}

function fmtLine(l: ExplanationLine) {
  return {
    tipo: l.kind === 'ORDER' ? 'pedido' : l.kind === 'RESERVATION' ? 'reserva' : 'bloqueio',
    descricao: l.label,
    cliente: l.customerName,
    situacao: l.situationName,
    quantidade: l.quantity,
    subtraido: l.subtracted,
    tratamento: l.treatment,
    motivo: l.reason,
    deposito_presumido: l.depositAssumed,
    vence_em_local: localTime(l.expiresAt),
  };
}

function summarize(r: AvailabilityResponse) {
  return {
    produto: { id: r.product.id, sku: r.product.sku, nome: r.product.name, unidade: r.product.unit },
    fonte_dos_dados: r.dataSource === 'demo' ? 'DEMONSTRAÇÃO (dados fictícios)' : 'Bling',
    base_de_calculo: r.baseMode === 'PHYSICAL' ? 'estoque físico' : 'saldo virtual',
    estoque_fisico_registrado: r.physicalTotal,
    saldo_virtual_bling: r.virtualTotal,
    descontos: {
      pedidos_pagos_confirmados_nao_baixados: r.deductions.committedOrders,
      pre_pedidos_com_reserva: r.deductions.preOrderReservations,
      reservas_complementares: r.deductions.localReservations,
      bloqueios_operacionais: r.deductions.blocked,
      compromissos_incertos_descontados_por_precaucao: r.deductions.uncertain,
    },
    total_descontado: r.totalDeducted,
    disponivel_para_nova_venda: r.availableForSale,
    saldo_calculado: r.available,
    status: r.status === 'CONFIRMED' ? 'CONFIRMADA' : 'NÃO CONFIRMADA',
    avisos: r.issues.map((i) => `${i.blocksConfirmation ? '[impede confirmação] ' : ''}${i.message}`),
    por_deposito: r.byDeposit.map((d) => ({ deposito: d.depositName, ignorado: d.ignored, fisico: d.physical, disponivel: d.availableForSale })),
    oportunidades_sem_reserva: r.opportunitiesTotal,
    entradas_previstas: r.incoming.map((e) => ({ pedido_compra: e.purchaseOrderNumber, quantidade: e.quantity, previsao: e.expectedDate })),
    dados_de_local: localTime(r.dataAsOf),
    saldo_atualizado_agora: r.refreshed,
    erro_atualizacao: r.refreshError,
    kit: r.kit ? { disponivel_kits: r.kit.availableForSale, status: r.kit.status, componentes: r.kit.components } : null,
  };
}

function filterDeposit(r: AvailabilityResponse, deposito?: string) {
  if (!deposito) return null;
  const n = normalize(deposito);
  return r.byDeposit.find((d) => normalize(d.depositName).includes(n)) ?? null;
}

export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<unknown> {
  if (!(name in toolSchemas)) return { erro: `Ferramenta desconhecida: ${name}` };
  const parsed = toolSchemas[name as ToolName].safeParse(rawInput);
  if (!parsed.success) return { erro: 'Parâmetros inválidos', detalhes: parsed.error.issues.map((i) => i.message) };
  const input = parsed.data as any;
  const settings = await getSettings();

  const withProduct = async (ref: string, fn: (p: ProductMatch) => Promise<unknown>) => {
    const res = await resolveProduct(ref, ctx);
    if ('notFound' in res) return { erro: `Nenhum produto encontrado para "${ref}".` };
    if ('ambiguous' in res) {
      ctx.cards.push({ type: 'candidates', data: res.ambiguous });
      return { ambiguo: true, mensagem: 'Mais de um produto corresponde. Peça ao vendedor para escolher.', candidatos: res.ambiguous.map((m) => ({ id: m.id, sku: m.sku, nome: m.name })) };
    }
    ctx.lastProductId = res.product.id;
    return fn(res.product);
  };

  switch (name as ToolName) {
    case 'buscar_produto': {
      const m = await searchProducts(input.termo, 8);
      if (m.length) ctx.cards.push({ type: 'candidates', data: m });
      return { resultados: m.map((x) => ({ id: x.id, sku: x.sku, nome: x.name, ativo: x.active, semelhanca: x.score })) };
    }
    case 'consultar_disponibilidade':
      return withProduct(input.produto, async (p) => {
        const r = await getAvailability(p.id, { viewer: ctx.viewer, freshness: 'critical' });
        if (!r) return { erro: 'Produto não encontrado.' };
        ctx.cards.push({ type: 'availability', data: r });
        const dep = filterDeposit(r, input.deposito);
        return { ...summarize(r), deposito_filtrado: dep ? { deposito: dep.depositName, disponivel: dep.availableForSale, fisico: dep.physical } : undefined };
      });
    case 'verificar_venda':
      return withProduct(input.produto, async (p) => {
        const r = await getAvailability(p.id, { viewer: ctx.viewer, freshness: 'critical' });
        if (!r) return { erro: 'Produto não encontrado.' };
        const dep = filterDeposit(r, input.deposito);
        const base = r.kit ? { ...r, availableForSale: r.kit.availableForSale, status: r.kit.status === 'UNCONFIRMED' ? 'UNCONFIRMED' as const : r.status } : r;
        const effective = dep ? { ...base, availableForSale: dep.availableForSale, available: dep.available } : base;
        const sale = checkSale(effective, input.quantidade);
        ctx.cards.push({ type: 'availability', data: r, sale });
        if (sale.possible === false) {
          await upsertAlert({
            type: 'INSUFFICIENT_FOR_SALE', severity: 'info', dedupeKey: `insufficient:${p.id}:${new Date().toISOString().slice(0, 13)}`,
            productId: p.id, userId: ctx.viewer.id,
            message: `${p.sku ?? p.name}: consulta de venda de ${input.quantidade} sem saldo suficiente (disponível ${effective.availableForSale}).`,
          });
        }
        return { verificacao: { quantidade_solicitada: sale.requested, possivel: sale.possible === null ? 'NÃO CONFIRMADO' : sale.possible, restante_apos_venda: sale.remainingAfterSale, faltam: sale.shortfall, mensagem: sale.message, deposito: dep?.depositName }, ...summarize(r) };
      });
    case 'compromissos_do_produto':
      return withProduct(input.produto, async (p) => {
        const r = await getAvailability(p.id, { viewer: ctx.viewer });
        if (!r) return { erro: 'Produto não encontrado.' };
        ctx.cards.push({ type: 'availability', data: r });
        const lines = r.lines.filter((l) => l.treatment !== 'NOT_COUNTED' || l.kind !== 'ORDER' || l.situationName);
        return { produto: { sku: p.sku, nome: p.name }, compromissos: lines.slice(0, 40).map(fmtLine), total_linhas: lines.length, disponivel_para_nova_venda: r.availableForSale, status: r.status };
      });
    case 'reservas_do_cliente': {
      const term = `%${input.cliente.trim()}%`;
      const { rows: res } = await pool.query(
        `SELECT r.id, r.quantity, r.status, r.expires_at, r.customer_name, r.reason, r.seller_user_id, u.name AS seller, p.sku, p.name
         FROM reservations r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.seller_user_id
         WHERE r.customer_name ILIKE $1 AND r.status IN ('PENDING', 'ACTIVE', 'EXPIRED') ORDER BY r.created_at DESC LIMIT 50`,
        [term],
      );
      const { rows: ord } = await pool.query(
        `SELECT o.id, o.number, o.customer_name, o.seller_id, s.name AS situacao, COALESCE(r1.category, r2.category, 'UNMAPPED') AS category,
                p.sku, p.name, i.quantity
         FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id LEFT JOIN products p ON p.id = i.product_id
         LEFT JOIN situations s ON s.id = o.situation_id
         LEFT JOIN situation_rules r1 ON r1.situation_id = o.situation_id LEFT JOIN situation_rules r2 ON r2.situation_id = s.inherited_id
         WHERE NOT o.deleted AND o.customer_name ILIKE $1
           AND COALESCE(r1.category, r2.category, 'UNMAPPED') IN ('COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY', 'UNMAPPED')
         ORDER BY o.order_date DESC NULLS LAST LIMIT 50`,
        [term],
      );
      const visibleRes = res.filter((r) => canSeeCustomer({ sellerId: null, sellerUserId: r.seller_user_id }, ctx.viewer, settings));
      const visibleOrd = ord.filter((o) => canSeeCustomer({ sellerId: o.seller_id, sellerUserId: null }, ctx.viewer, settings));
      const hidden = res.length - visibleRes.length + ord.length - visibleOrd.length;
      const rows: (string | number | null)[][] = [
        ...visibleRes.map((r) => ['Reserva', r.customer_name, `${r.sku ?? ''} ${r.name}`, r.quantity, r.status, r.seller]),
        ...visibleOrd.map((o) => [`Pedido ${o.number ?? o.id}`, o.customer_name, `${o.sku ?? ''} ${o.name ?? ''}`, o.quantity, o.situacao ?? o.category, null]),
      ];
      if (rows.length) ctx.cards.push({ type: 'table', title: `Compromissos do cliente "${input.cliente}"`, columns: ['Origem', 'Cliente', 'Produto', 'Qtd', 'Situação', 'Vendedor'], rows });
      return {
        reservas: visibleRes.map((r) => ({ produto: `${r.sku ?? ''} ${r.name}`, quantidade: r.quantity, status: r.status, vence_em: r.expires_at, vence_em_local: localTime(r.expires_at), cliente: r.customer_name, vendedor: r.seller, motivo: r.reason })),
        pedidos: visibleOrd.map((o) => ({ pedido: o.number ?? o.id, cliente: o.customer_name, produto: `${o.sku ?? ''} ${o.name ?? ''}`, quantidade: o.quantity, situacao: o.situacao, categoria: o.category })),
        ocultos_por_permissao: hidden,
      };
    }
    case 'pedidos_por_situacao': {
      const q = normalize(input.situacao);
      const categoryMap: Record<string, string> = { confirmad: 'COMMITTED', pago: 'COMMITTED', pre: 'PRE_ORDER_RESERVED', reserv: 'PRE_ORDER_RESERVED', cota: 'OPPORTUNITY', oportun: 'OPPORTUNITY' };
      const cat = Object.entries(categoryMap).find(([k]) => q.startsWith(k))?.[1] ?? null;
      const { rows } = await pool.query(
        `SELECT o.id, o.number, o.customer_name, o.seller_id, o.order_date, o.expected_date, s.name AS situacao,
                COALESCE(r1.category, r2.category, 'UNMAPPED') AS category,
                string_agg(COALESCE(p.sku, i.sku, '?') || ' × ' || trim_scale(i.quantity)::text, ', ') AS itens
         FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id LEFT JOIN products p ON p.id = i.product_id
         LEFT JOIN situations s ON s.id = o.situation_id
         LEFT JOIN situation_rules r1 ON r1.situation_id = o.situation_id LEFT JOIN situation_rules r2 ON r2.situation_id = s.inherited_id
         WHERE NOT o.deleted AND COALESCE(r1.category, r2.category, 'UNMAPPED') IN ('COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY', 'UNMAPPED')
         GROUP BY o.id, s.name, r1.category, r2.category ORDER BY o.order_date NULLS LAST LIMIT 300`,
      );
      const filtered = rows.filter((o) => (cat ? o.category === cat : normalize(o.situacao).includes(q))).slice(0, 50);
      const out = filtered.map((o) => ({
        pedido: o.number ?? o.id,
        cliente: canSeeCustomer({ sellerId: o.seller_id, sellerUserId: null }, ctx.viewer, settings) ? o.customer_name : 'Cliente de outro vendedor',
        situacao: o.situacao,
        categoria: o.category,
        data: o.order_date,
        previsao: o.expected_date,
        itens: o.itens,
      }));
      if (out.length) ctx.cards.push({ type: 'table', title: `Pedidos — ${input.situacao}`, columns: ['Pedido', 'Cliente', 'Situação', 'Data', 'Itens'], rows: out.map((o) => [o.pedido, o.cliente, o.situacao, o.data, o.itens]) });
      return { total: out.length, pedidos: out };
    }
    case 'produtos_com_divergencia': {
      const { rows } = await pool.query(
        `SELECT a.type, a.severity, a.message, a.product_id, p.sku, p.name FROM alerts a LEFT JOIN products p ON p.id = a.product_id
         WHERE a.status <> 'resolved' AND a.type IN ('NEGATIVE_BALANCE', 'OVERCOMMITTED', 'POSSIBLE_DUPLICATE', 'UNMAPPED_SITUATION',
           'CANCELLED_AFTER_POSTING', 'CANCELLED_WITH_ACTIVE_RESERVATION', 'COMMITTED_WITHOUT_POSTING', 'PARTIAL_DELIVERY_NOT_POSTED')
         ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.updated_at DESC LIMIT 50`,
      );
      if (rows.length) ctx.cards.push({ type: 'table', title: 'Divergências abertas', columns: ['Gravidade', 'Tipo', 'Produto', 'Descrição'], rows: rows.map((r) => [r.severity, r.type, r.sku ?? r.name ?? '—', r.message]) });
      return { total: rows.length, divergencias: rows.map((r) => ({ tipo: r.type, gravidade: r.severity, produto: r.sku ?? r.name, descricao: r.message })) };
    }
    case 'reservas_vencendo': {
      const hours = input.horas ?? settings.reservations.expiringSoonHours;
      const { rows } = await pool.query(
        `SELECT r.id, r.quantity, r.status, r.expires_at, r.customer_name, r.seller_user_id, u.name AS seller, p.sku, p.name
         FROM reservations r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.seller_user_id
         WHERE (r.status = 'ACTIVE' AND r.expires_at <= now() + ($1 || ' hours')::interval) OR r.status = 'EXPIRED'
         ORDER BY r.expires_at LIMIT 100`,
        [String(hours)],
      );
      const out = rows.map((r) => ({
        produto: `${r.sku ?? ''} ${r.name}`.trim(),
        quantidade: r.quantity,
        cliente: canSeeCustomer({ sellerId: null, sellerUserId: r.seller_user_id }, ctx.viewer, settings) ? r.customer_name : 'Cliente de outro vendedor',
        vendedor: r.seller,
        vence_em: r.expires_at,
        vence_em_local: localTime(r.expires_at),
        vencida: r.status === 'EXPIRED' || r.expires_at <= new Date(),
      }));
      if (out.length) ctx.cards.push({ type: 'table', title: `Reservas vencendo (${hours} h) e vencidas`, columns: ['Produto', 'Qtd', 'Cliente', 'Vendedor', 'Vence em'], rows: out.map((o) => [o.produto, o.quantidade, o.cliente, o.vendedor, o.vence_em_local]) });
      return { horas: hours, reservas: out };
    }
    case 'entradas_previstas': {
      let productId: number | null = null;
      if (input.produto) {
        const res = await resolveProduct(input.produto, ctx);
        if ('ambiguous' in res) {
          ctx.cards.push({ type: 'candidates', data: res.ambiguous });
          return { ambiguo: true, candidatos: res.ambiguous.map((m) => ({ sku: m.sku, nome: m.name })) };
        }
        if ('notFound' in res) return { erro: `Produto "${input.produto}" não encontrado.` };
        productId = res.product.id;
        ctx.lastProductId = productId;
      }
      const { rows } = await pool.query(
        `SELECT po.number, po.expected_date, po.supplier_name, p.sku, p.name, i.quantity
         FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.purchase_order_id LEFT JOIN products p ON p.id = i.product_id
         WHERE po.situation_value IN (0, 3) AND ($1::bigint IS NULL OR i.product_id = $1) AND ($2::date IS NULL OR po.expected_date <= $2)
         ORDER BY po.expected_date NULLS LAST LIMIT 100`,
        [productId, input.ate ?? null],
      );
      const out = rows.map((r) => ({ pedido_compra: r.number, previsao: r.expected_date, fornecedor: r.supplier_name, produto: `${r.sku ?? ''} ${r.name ?? ''}`.trim(), quantidade: r.quantity }));
      if (out.length) ctx.cards.push({ type: 'table', title: 'Entradas previstas', columns: ['Pedido compra', 'Previsão', 'Fornecedor', 'Produto', 'Qtd'], rows: out.map((o) => [o.pedido_compra, o.previsao, o.fornecedor, o.produto, o.quantidade]) });
      return { observacao: 'Entradas previstas não aumentam a disponibilidade atual até serem recebidas e lançadas no Bling.', hoje: new Date().toISOString().slice(0, 10), entradas: out };
    }
    case 'simular_cancelamento': {
      const { rows } = await pool.query(
        `SELECT o.id, o.number, i.product_id FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id
         WHERE NOT o.deleted AND (o.number = $1 OR o.id = $1) AND i.product_id IS NOT NULL`,
        [input.pedido],
      );
      if (!rows.length) return { erro: `Pedido ${input.pedido} não encontrado entre os pedidos sincronizados.` };
      let productIds = [...new Set(rows.map((r) => r.product_id as number))];
      if (input.produto) {
        const res = await resolveProduct(input.produto, ctx);
        if ('product' in res) productIds = productIds.filter((id) => id === res.product.id);
      }
      const orderId = rows[0].id;
      const out = [];
      for (const pid of productIds) {
        const atual = await getAvailability(pid, { viewer: ctx.viewer });
        const sim = await getAvailability(pid, { viewer: ctx.viewer, excludeOrderIds: [orderId] });
        if (!atual || !sim) continue;
        ctx.lastProductId = pid;
        out.push({ produto: `${atual.product.sku ?? ''} ${atual.product.name}`.trim(), disponivel_hoje: atual.availableForSale, disponivel_se_cancelar: sim.availableForSale, diferenca: sim.availableForSale - atual.availableForSale, status: sim.status });
      }
      if (out.length) ctx.cards.push({ type: 'table', title: `Simulação: cancelamento do pedido ${input.pedido}`, columns: ['Produto', 'Hoje', 'Se cancelar', 'Diferença'], rows: out.map((o) => [o.produto, o.disponivel_hoje, o.disponivel_se_cancelar, o.diferenca]) });
      return { simulacao: true, observacao: 'Simulação apenas — nada foi alterado.', resultados: out };
    }
    case 'listar_produtos': {
      const filtro = input.filtro ?? 'disponiveis';
      const limite = input.limite ?? 30;
      const busca = input.busca ? `%${input.busca}%` : null;
      const { rows } = await pool.query<{ id: number }>(
        `SELECT p.id FROM products p
         WHERE p.active AND p.format <> 'V'
           AND (EXISTS (SELECT 1 FROM stock_balances b WHERE b.product_id = p.id) OR p.format = 'E')
           AND ($1::text IS NULL OR p.name ILIKE $1 OR p.sku ILIKE $1)
         ORDER BY p.name LIMIT 500`,
        [busca],
      );
      const items: { id: number; sku: string | null; nome: string; disponivel: number; fisico: number | null; status: string; unidade: string | null }[] = [];
      for (const { id } of rows) {
        const r = await getAvailability(id, { viewer: ctx.viewer });
        if (!r) continue;
        items.push({ id, sku: r.product.sku, nome: r.product.name, disponivel: r.availableForSale, fisico: r.physicalTotal, status: r.status, unidade: r.product.unit ?? null });
      }
      const filtered = items
        .filter((i) => (filtro === 'disponiveis' ? i.disponivel > 0 : filtro === 'sem_estoque' ? i.disponivel <= 0 : filtro === 'nao_confirmados' ? i.status !== 'CONFIRMED' : true))
        .sort((a, b) => b.disponivel - a.disponivel || a.nome.localeCompare(b.nome));
      const shown = filtered.slice(0, limite);
      if (shown.length) {
        ctx.cards.push({
          type: 'table',
          title: filtro === 'sem_estoque' ? 'Produtos sem saldo para venda' : filtro === 'nao_confirmados' ? 'Produtos com disponibilidade não confirmada' : 'Produtos disponíveis para venda',
          columns: ['SKU', 'Produto', 'Disponível', 'Físico', 'Status'],
          rows: shown.map((i) => [i.sku, i.nome, i.disponivel, i.fisico, i.status === 'CONFIRMED' ? 'Confirmada' : 'Não confirmada']),
        });
      }
      return {
        filtro,
        total_encontrado: filtered.length,
        exibidos: shown.length,
        produtos: shown.map((i) => ({ sku: i.sku, nome: i.nome, disponivel_para_venda: i.disponivel, fisico: i.fisico, unidade: i.unidade, status: i.status === 'CONFIRMED' ? 'CONFIRMADA' : 'NÃO CONFIRMADA' })),
      };
    }
    case 'status_sincronizacao': {
      const { rows } = await pool.query('SELECT resource, last_success_at, last_attempt_at, last_error, last_error_at FROM sync_state ORDER BY resource');
      return {
        modo: settings.appMode === 'demo' ? 'DEMONSTRAÇÃO (dados fictícios)' : 'Bling (produção)',
        recursos: rows.map((r) => ({ recurso: r.resource, ultimo_sucesso: r.last_success_at, ultima_tentativa: r.last_attempt_at, erro: r.last_error_at && (!r.last_success_at || r.last_error_at > r.last_success_at) ? r.last_error : null })),
      };
    }
  }
}
