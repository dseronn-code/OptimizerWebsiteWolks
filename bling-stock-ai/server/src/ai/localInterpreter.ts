import { config } from '../config.js';
import { normalize } from '../lib/text.js';
import { executeTool, type ToolContext } from './tools.js';

/**
 * Interpretador local por regras — usado quando não há chave de API de IA configurada
 * (ou como contingência). Reconhece as perguntas frequentes e monta respostas a partir
 * das mesmas ferramentas determinísticas usadas pelo agente de IA.
 */

const STOPWORDS = new Set(
  `a o as os um uma uns umas de do da dos das no na nos nas em para pra pro por com sem e ou que qual quais quanto quantos quanta quantas
   tem temos ha tenho existe existem consigo conseguimos posso podemos pode vender venda vendo atender agora hoje ainda disponivel disponiveis
   livre livres estoque saldo produto produtos item itens sku codigo unidade unidades un und pecas peca pcs pc caixa caixas kg metros
   me diga mostre mostra ver veja sobre isso esse este desse deste dessa desta voce voces nos eu sim nao favor por favor oi ola
   quero preciso gostaria saber`.split(/\s+/),
);

function extractQuantity(q: string): number | null {
  const m = q.match(/(\d+(?:[.,]\d+)?)\s*(?:unidades?|un\b|und\b|pe[cç]as?|pcs?\b|caixas?|kg|metros?|itens?|x\b)?/i);
  if (!m) return null;
  return Number(m[1].replace(',', '.'));
}

function productTerm(question: string, extraStop: string[] = []): string {
  const extra = new Set(extraStop);
  return normalize(question)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w) && !extra.has(w) && !/^\d+([.,]\d+)?$/.test(w))
    .join(' ');
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function fmtDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: config.APP_TIMEZONE }) : 'sem dados';
}

function availabilityText(r: any, saleMsg?: string): string {
  const lines = [`Produto: ${r.produto.sku ? `${r.produto.sku} — ` : ''}${r.produto.nome}`];
  if (r.fonte_dos_dados.startsWith('DEMO')) lines.unshift('⚠️ Ambiente de DEMONSTRAÇÃO — dados fictícios.');
  lines.push(`Estoque físico registrado: ${fmt(r.estoque_fisico_registrado)}`);
  const d = r.descontos;
  if (d.pedidos_pagos_confirmados_nao_baixados) lines.push(`Pedidos pagos e confirmados ainda não baixados: ${fmt(d.pedidos_pagos_confirmados_nao_baixados)}`);
  if (d.pre_pedidos_com_reserva) lines.push(`Pré-pedidos com reserva válida: ${fmt(d.pre_pedidos_com_reserva)}`);
  if (d.reservas_complementares) lines.push(`Reservas complementares: ${fmt(d.reservas_complementares)}`);
  if (d.bloqueios_operacionais) lines.push(`Bloqueios operacionais: ${fmt(d.bloqueios_operacionais)}`);
  if (d.compromissos_incertos_descontados_por_precaucao) lines.push(`Compromissos incertos (descontados por precaução): ${fmt(d.compromissos_incertos_descontados_por_precaucao)}`);
  lines.push(`Estoque disponível para novas vendas: ${fmt(r.disponivel_para_nova_venda)}`);
  if (r.kit) lines.push(`Kits montáveis com os componentes: ${fmt(r.kit.disponivel_kits)}`);
  if (saleMsg) lines.push(`Resposta: ${saleMsg}`);
  else if (r.status === 'CONFIRMADA') lines.push(`Resposta: há ${fmt(r.disponivel_para_nova_venda)} disponível(is) para nova venda.`);
  if (r.status !== 'CONFIRMADA') {
    lines.push(`Atenção: disponibilidade NÃO confirmada.`);
    for (const a of r.avisos.slice(0, 5)) lines.push(`• ${a}`);
  } else if (r.avisos.length) {
    for (const a of r.avisos.slice(0, 3)) lines.push(`• ${a}`);
  }
  if (r.entradas_previstas?.length) lines.push(`Entradas previstas (não contam no disponível): ${r.entradas_previstas.map((e: any) => `${fmt(e.quantidade)} em ${e.previsao ?? 'data não informada'}`).join('; ')}`);
  lines.push(`Dados de: ${fmtDate(r.dados_de)}${r.saldo_atualizado_agora ? ' (saldo atualizado agora no Bling)' : ''} · Status: ${r.status.toLowerCase()}`);
  return lines.join('\n');
}

function ambiguousText(res: any): string | null {
  if (res?.ambiguo) {
    return `Encontrei mais de um produto. Qual deles?\n${res.candidatos.map((c: any) => `• ${c.sku ?? 's/ SKU'} — ${c.nome}`).join('\n')}`;
  }
  if (res?.erro) return res.erro;
  return null;
}

export async function interpretLocally(question: string, ctx: ToolContext): Promise<{ answer: string; toolCalls: { name: string; input: unknown }[] }> {
  const q = normalize(question);
  const calls: { name: string; input: unknown }[] = [];
  const run = async (name: string, input: unknown) => {
    calls.push({ name, input });
    return executeTool(name, input, ctx) as Promise<any>;
  };
  const refersToLast = /\b(desse|deste|esse|este|dele|mesmo)\b/.test(q) && ctx.lastProductId !== null;
  const productOr = (extra: string[] = []) => (refersToLast && !productTerm(question, extra) ? 'esse' : productTerm(question, extra) || (ctx.lastProductId ? 'esse' : ''));

  // --- sincronização
  if (/\b(sincroniz|atualizad|ultima atualiza)/.test(q) && !/\bproduto\b/.test(q)) {
    const r = await run('status_sincronizacao', {});
    return {
      answer: [`Modo: ${r.modo}`, ...r.recursos.map((x: any) => `• ${x.recurso}: último sucesso ${fmtDate(x.ultimo_sucesso)}${x.erro ? ` — ERRO: ${x.erro}` : ''}`)].join('\n'),
      toolCalls: calls,
    };
  }
  // --- divergências
  if (/diverg|inconsist|negativ/.test(q)) {
    const r = await run('produtos_com_divergencia', {});
    return { answer: r.total ? `${r.total} divergência(s) abertas:\n${r.divergencias.map((d: any) => `• [${d.gravidade}] ${d.descricao}`).join('\n')}` : 'Nenhuma divergência aberta no momento.', toolCalls: calls };
  }
  // --- reservas vencendo
  if (/(vencend|vencer|vencid|expira)/.test(q) && /reserv/.test(q)) {
    const r = await run('reservas_vencendo', {});
    return {
      answer: r.reservas.length
        ? `Reservas vencendo nas próximas ${r.horas} h ou já vencidas:\n${r.reservas.map((x: any) => `• ${x.produto}: ${fmt(x.quantidade)} — ${x.cliente} (${x.vendedor}) ${x.vencida ? 'VENCIDA' : `vence ${fmtDate(x.vence_em)}`}`).join('\n')}`
        : `Nenhuma reserva vencendo nas próximas ${r.horas} h.`,
      toolCalls: calls,
    };
  }
  // --- simulação de cancelamento
  const cancel = q.match(/cancel\w*.*?pedido\s*(?:n|numero|no)?\s*(\d+)|pedido\s*(?:n|numero|no)?\s*(\d+).*cancel/);
  if (cancel) {
    const pedido = Number(cancel[1] ?? cancel[2]);
    const r = await run('simular_cancelamento', { pedido });
    if (r.erro) return { answer: r.erro, toolCalls: calls };
    return {
      answer: `Simulação (nada foi alterado) — cancelamento do pedido ${pedido}:\n${r.resultados.map((x: any) => `• ${x.produto}: hoje ${fmt(x.disponivel_hoje)} → se cancelar ${fmt(x.disponivel_se_cancelar)} (+${fmt(x.diferenca)})`).join('\n')}`,
      toolCalls: calls,
    };
  }
  // --- entradas previstas
  if (/(entrada|chegar|chega|previst|recebiment|compra)/.test(q)) {
    const term = productTerm(question, ['entrada', 'entradas', 'prevista', 'previstas', 'previsto', 'chegar', 'chega', 'amanha', 'semana', 'alguma', 'algum', 'recebimento', 'compra']);
    let ate: string | undefined;
    if (/amanha/.test(q)) ate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    else if (/semana/.test(q)) ate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const r = await run('entradas_previstas', { produto: term || undefined, ate });
    const amb = ambiguousText(r);
    if (amb) return { answer: amb, toolCalls: calls };
    return {
      answer: r.entradas.length
        ? `Entradas previstas${ate ? ` até ${ate}` : ''}:\n${r.entradas.map((e: any) => `• ${e.produto}: ${fmt(e.quantidade)} — previsão ${e.previsao ?? 'não informada'} (compra ${e.pedido_compra ?? '?'}, ${e.fornecedor ?? 'fornecedor'})`).join('\n')}\n${r.observacao}`
        : `Não há entradas previstas${ate ? ` até ${ate}` : ''}${term ? ' para esse produto' : ''}.`,
      toolCalls: calls,
    };
  }
  // --- pedidos por situação
  if (/transportad|aguardando|pre ?pedidos?|cotac/.test(q) && /(pedido|pre|quais|aguard|cotac)/.test(q) && !/vender/.test(q)) {
    const situacao = /transportad/.test(q) ? 'transportadora' : /cotac/.test(q) ? 'cotacoes' : /pre ?pedido/.test(q) ? 'pre-pedidos' : 'aguardando';
    const r = await run('pedidos_por_situacao', { situacao });
    return {
      answer: r.total ? `${r.total} pedido(s) — ${situacao}:\n${r.pedidos.map((p: any) => `• Pedido ${p.pedido} — ${p.cliente} — ${p.situacao ?? p.categoria} — ${p.itens}`).join('\n')}` : `Nenhum pedido encontrado para "${situacao}".`,
      toolCalls: calls,
    };
  }
  // --- cliente
  const cliente = question.match(/cliente\s+([A-Za-zÀ-ÿ][\wÀ-ÿ .'-]{1,60}?)(?:\s+tem\b|\s+possui\b|\?|$)/i);
  if (cliente && !/produto/.test(q)) {
    const r = await run('reservas_do_cliente', { cliente: cliente[1].trim() });
    const parts = [
      ...r.reservas.map((x: any) => `• Reserva: ${x.produto} — ${fmt(x.quantidade)} (${x.status}, vence ${fmtDate(x.vence_em)}, vendedor ${x.vendedor})`),
      ...r.pedidos.map((x: any) => `• Pedido ${x.pedido}: ${x.produto} — ${fmt(x.quantidade)} (${x.situacao ?? x.categoria})`),
    ];
    return {
      answer: parts.length ? `Compromissos de "${cliente[1].trim()}":\n${parts.join('\n')}${r.ocultos_por_permissao ? `\n(${r.ocultos_por_permissao} registro(s) de outros vendedores não exibidos.)` : ''}` : `Não encontrei reservas ou pedidos em aberto para "${cliente[1].trim()}".`,
      toolCalls: calls,
    };
  }
  // --- compromissos do produto / por que difere
  if (/(prendendo|compromet|quem reservou|quais pedidos|por que|porque|diferenc|explica)/.test(q)) {
    const term = productOr(['prendendo', 'comprometido', 'comprometendo', 'quem', 'reservou', 'pedidos', 'pedido', 'por', 'porque', 'aparecem', 'aparece', 'mas', 'somente', 'so', 'bling', 'diferenca', 'explica', 'reservas', 'essas']);
    if (!term) return { answer: 'De qual produto? Informe o SKU ou o nome.', toolCalls: calls };
    const r = await run('compromissos_do_produto', { produto: term });
    const amb = ambiguousText(r);
    if (amb) return { answer: amb, toolCalls: calls };
    const ativos = r.compromissos.filter((c: any) => c.subtraido > 0 || c.tratamento === 'ALREADY_IN_BASE' || c.tratamento === 'SUPERSEDED');
    return {
      answer: `${r.produto.sku ?? ''} ${r.produto.nome}`.trim() + ` — disponível para nova venda: ${fmt(r.disponivel_para_nova_venda)} (${r.status === 'CONFIRMED' ? 'confirmado' : 'NÃO confirmado'}).\n` +
        (ativos.length
          ? `O que explica a diferença:\n${ativos.map((c: any) => `• ${c.descricao}${c.cliente ? ` — ${c.cliente}` : ''}: ${fmt(c.quantidade)} → ${c.subtraido > 0 ? `subtrai ${fmt(c.subtraido)}` : 'não subtrai de novo'}. ${c.motivo}`).join('\n')}`
          : 'Não há pedidos, reservas ou bloqueios reduzindo a disponibilidade.'),
      toolCalls: calls,
    };
  }
  // --- venda de quantidade
  const qty = extractQuantity(q);
  if (qty !== null && /(vend|atender|consig|temos|tem|da pra|possivel|posso|disponi)/.test(q)) {
    const term = productOr(['vender', 'disponiveis', 'consigo', 'possivel', 'atender', 'pra', 'da']);
    if (!term) return { answer: 'De qual produto? Informe o SKU ou o nome.', toolCalls: calls };
    const r = await run('verificar_venda', { produto: term, quantidade: qty });
    const amb = ambiguousText(r);
    if (amb) return { answer: amb, toolCalls: calls };
    return { answer: availabilityText(r, r.verificacao.mensagem), toolCalls: calls };
  }
  // --- disponibilidade simples
  const term = productOr(['quanto', 'livre', 'disponivel']);
  if (!term) {
    return {
      answer: 'Posso consultar disponibilidade de produtos, verificar se uma venda é possível, listar compromissos, reservas de clientes, entradas previstas e divergências. Ex.: "Consigo vender 35 peças do ABC agora?"',
      toolCalls: calls,
    };
  }
  const r = await run('consultar_disponibilidade', { produto: term });
  const amb = ambiguousText(r);
  if (amb) return { answer: amb, toolCalls: calls };
  return { answer: availabilityText(r), toolCalls: calls };
}
