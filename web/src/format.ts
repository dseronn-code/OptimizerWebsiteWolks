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

/** Ações registradas no histórico de reservas. */
export const RESERVATION_ACTION: Record<string, string> = {
  create: 'Criada',
  approve: 'Aprovada',
  reject: 'Rejeitada',
  cancel: 'Cancelada',
  release: 'Liberada',
  renew: 'Renovada',
  link_order: 'Vinculada a pedido',
  expire: 'Venceu',
  convert: 'Convertida em pedido',
};

/** Etapas de sincronização com o Bling. */
export const SYNC_RESOURCE: Record<string, string> = {
  deposits: 'Depósitos',
  situations: 'Situações de pedido',
  products: 'Produtos',
  balances: 'Saldos de estoque',
  balances_on_demand: 'Saldo (consulta de produto)',
  sales_orders: 'Pedidos de venda',
  purchase_orders: 'Pedidos de compra',
  reconcile_orders: 'Conferência de pedidos',
  alerts_scan: 'Verificação de alertas',
};

export const SYNC_STATUS: Record<string, string> = {
  running: 'Em andamento',
  success: 'Concluída',
  error: 'Falhou',
};

/** Quem disparou a sincronização (usuários aparecem pelo login). */
export function syncOrigin(v: string | null | undefined): string {
  if (!v) return '—';
  const map: Record<string, string> = {
    agendado: 'Automática',
    conexao: 'Conexão ao Bling',
    consulta: 'Consulta de produto',
    webhook: 'Aviso do Bling',
    'demo-seed': 'Dados de demonstração',
  };
  return map[v] ?? `Manual (${v})`;
}

export const JOB_TYPE: Record<string, string> = {
  sync_incremental: 'Sincronização rápida',
  sync_full: 'Sincronização completa',
  sync_products_full: 'Catálogo completo de produtos',
  sync_products_incremental: 'Produtos alterados',
  reconcile: 'Conferência de pedidos',
  alerts_scan: 'Verificação de alertas',
  expire_reservations: 'Vencimento de reservas',
  process_webhook: 'Aviso do Bling',
};

export const JOB_STATUS: Record<string, string> = {
  pending: 'Na fila',
  running: 'Executando',
  done: 'Concluído',
  failed: 'Falhou',
};

export const WEBHOOK_STATUS: Record<string, string> = {
  received: 'Recebido',
  processed: 'Processado',
  ignored: 'Ignorado',
  failed: 'Falhou',
  duplicate: 'Duplicado',
  queued: 'Na fila',
  pending: 'Na fila',
  error: 'Falhou',
};

export const BLING_STATUS: Record<string, string> = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Erro na conexão',
  expired: 'Autorização expirada',
};

/** Ações do registro de auditoria. */
export const AUDIT_ACTION: Record<string, string> = {
  'auth.login': 'Entrou no sistema',
  'auth.failed': 'Tentativa de acesso com senha errada',
  'auth.locked': 'Conta bloqueada por tentativas',
  'auth.logout_all': 'Encerrou todas as sessões',
  'auth.mfa_enabled': 'Ativou a verificação em 2 etapas',
  'auth.password_changed': 'Trocou a senha',
  'bling.connect_started': 'Iniciou conexão com o Bling',
  'bling.connected': 'Conectou o Bling',
  'bling.disconnect': 'Desconectou o Bling',
  'block.create': 'Bloqueou estoque',
  'block.release': 'Liberou bloqueio de estoque',
  'demo.purged': 'Apagou os dados de demonstração',
  'order.override': 'Ajustou a regra de um pedido',
  'order_item.fulfillment': 'Registrou entrega de item',
  'reservation.approve': 'Aprovou reserva',
  'reservation.create': 'Criou reserva',
  'reservation.link_order': 'Vinculou reserva a pedido',
  'reservation.renew': 'Renovou reserva',
  'settings.update': 'Alterou parâmetros',
  'signup.code_resent': 'Código de cadastro reenviado',
  'signup.code_sent': 'Código de cadastro enviado',
  'signup.completed': 'Cadastro confirmado',
  'situation_rule.suggested': 'Aplicou sugestão de regras de situação',
  'situation_rule.update': 'Alterou regra de situação',
  'sync.requested': 'Pediu sincronização',
  'user.create': 'Criou usuário',
  'user.update': 'Alterou usuário',
  'webhook.rejected': 'Aviso do Bling recusado',
};

const AUDIT_ENTITY: Record<string, string> = {
  user: 'Usuário',
  reservation: 'Reserva',
  order: 'Pedido',
  sales_order: 'Pedido',
  order_item: 'Item de pedido',
  block: 'Bloqueio',
  situation_rule: 'Regra de situação',
  situation: 'Situação',
  settings: 'Parâmetros',
  product: 'Produto',
};

export function auditEntity(entity: string | null, id: string | null): string {
  if (!entity) return '—';
  const label = AUDIT_ENTITY[entity] ?? entity;
  if (!id) return label;
  // identificadores longos (UUID) não dizem nada para quem lê: mostra só o início
  return `${label} ${/^[0-9a-f-]{36}$/i.test(id) ? id.slice(0, 8) : `#${id}`}`;
}

const DETAIL_KEY: Record<string, string> = {
  email: 'e-mail', approve: 'aprovado', role: 'perfil', active: 'ativo', quantity: 'quantidade', reason: 'motivo',
  expiresAt: 'vence em', blingOrderId: 'pedido Bling', forceUnconfirmed: 'mesmo sem confirmação', kind: 'tipo',
  resetMfa: '2FA zerado', revokeSessions: 'sessões encerradas', category: 'categoria', stockEffect: 'baixa',
  appMode: 'modo', username: 'usuário', name: 'nome', count: 'quantidade', ip: 'IP',
  pendingApproval: 'aguardando aprovação', mfa: 'verificação em 2 etapas', recovery: 'código de recuperação',
  productId: 'produto', password: 'senha alterada', userId: 'usuário',
};

const DETAIL_VALUE: Record<string, Record<string, string>> = {
  kind: { incremental: 'rápida', full: 'completa', reconcile: 'conferência de pedidos', alerts: 'alertas' },
  role: { vendedor: 'Vendedor', gestor: 'Gestor', admin: 'Administrador' },
  appMode: { demo: 'demonstração', live: 'Bling real' },
};

/** Detalhes da auditoria em texto legível (sem JSON). */
export function auditDetails(d: unknown): string {
  if (d === null || d === undefined) return '';
  if (typeof d !== 'object') return String(d);
  return Object.entries(d as Record<string, unknown>)
    .map(([k, v]) => {
      const val = typeof v === 'boolean' ? (v ? 'sim' : 'não')
        : typeof v === 'object' && v !== null ? JSON.stringify(v)
        : DETAIL_VALUE[k]?.[String(v)] ?? String(v);
      return `${DETAIL_KEY[k] ?? k}: ${val}`;
    })
    .join(' · ');
}

/** "1 produto" / "3 produtos" — evita o "produto(s)". */
export function plural(n: number, one: string, many: string): string {
  return `${num(n)} ${Math.abs(n) === 1 ? one : many}`;
}
