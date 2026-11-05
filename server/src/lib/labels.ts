import { config } from '../config.js';

/** Textos em português para códigos internos que aparecem em mensagens e respostas. */

export const SYNC_RESOURCE_LABEL: Record<string, string> = {
  deposits: 'depósitos',
  situations: 'situações de pedido',
  products: 'produtos',
  balances: 'saldos de estoque',
  balances_on_demand: 'saldo sob consulta',
  sales_orders: 'pedidos de venda',
  purchase_orders: 'pedidos de compra',
  reconcile_orders: 'conferência de pedidos',
  alerts_scan: 'verificação de alertas',
};

export const SEVERITY_LABEL: Record<string, string> = { critical: 'Crítico', warning: 'Atenção', info: 'Informativo' };

export const ISSUE_TYPE_LABEL: Record<string, string> = {
  NEGATIVE_BALANCE: 'Saldo negativo',
  OVERCOMMITTED: 'Pedidos acima do estoque',
  POSSIBLE_DUPLICATE: 'Possível desconto duplicado',
  UNMAPPED_SITUATION: 'Situação sem regra',
  CANCELLED_AFTER_POSTING: 'Cancelado após baixa',
  CANCELLED_WITH_ACTIVE_RESERVATION: 'Cancelado com reserva ativa',
  COMMITTED_WITHOUT_POSTING: 'Pedido sem baixa',
  PARTIAL_DELIVERY_NOT_POSTED: 'Entrega sem baixa',
};

export const CATEGORY_TEXT: Record<string, string> = {
  COMMITTED: 'Confirmado/pago',
  PRE_ORDER_RESERVED: 'Pré-pedido com reserva',
  OPPORTUNITY: 'Oportunidade/cotação',
  CANCELLED: 'Cancelado',
  FULFILLED: 'Atendido',
  IGNORED: 'Ignorado',
  UNMAPPED: 'Sem regra',
};

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' (datas puras, sem fuso). */
export function brDate(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  }
  return new Date(v).toLocaleDateString('pt-BR', { timeZone: config.APP_TIMEZONE });
}

/** Data e hora no fuso da empresa, ex.: 05/11/2026, 14:30. */
export function brDateTime(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return new Date(v).toLocaleString('pt-BR', { timeZone: config.APP_TIMEZONE, dateStyle: 'short', timeStyle: 'short' });
}

/** "1 pedido" / "3 pedidos" — evita o "pedido(s)" nas mensagens. */
export function pl(n: number, one: string, many: string): string {
  return `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${Math.abs(Number(n)) === 1 ? one : many}`;
}
