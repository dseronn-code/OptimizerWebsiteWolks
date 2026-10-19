export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

export const CATEGORY_LABEL: Record<string, string> = {
  COMMITTED: 'Confirmado/pago',
  PRE_ORDER_RESERVED: 'Pré-pedido com reserva',
  OPPORTUNITY: 'Oportunidade/cotação',
  CANCELLED: 'Cancelado',
  FULFILLED: 'Atendido',
  IGNORED: 'Ignorado',
  UNMAPPED: 'Sem regra',
};

export const RESERVATION_STATUS: Record<string, string> = {
  PENDING: 'Aguardando aprovação',
  ACTIVE: 'Ativa',
  EXPIRED: 'Vencida',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
  RELEASED: 'Liberada',
  CONVERTED: 'Convertida em pedido',
};

export const TREATMENT_LABEL: Record<string, string> = {
  SUBTRACTED: 'Subtraído',
  ALREADY_IN_BASE: 'Já descontado no saldo',
  NOT_COUNTED: 'Não reduz',
  SUPERSEDED: 'Contado pelo pedido',
};
