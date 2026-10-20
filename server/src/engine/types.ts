/**
 * Tipos do motor de disponibilidade.
 *
 * O motor é uma função pura: recebe um retrato (snapshot) dos dados já carregados
 * do banco e devolve a disponibilidade calculada com a explicação de cada linha.
 * Nenhum acesso a rede/banco acontece aqui — isso o torna determinístico e testável.
 */

/** Base de cálculo: saldo físico registrado ou saldo virtual do Bling. */
export type BaseMode = 'PHYSICAL' | 'VIRTUAL';

/** O que o pedido representa comercialmente (configurado por situação do Bling). */
export type CommitmentCategory =
  | 'COMMITTED' // pedido pago/confirmado aguardando retirada ou transporte
  | 'PRE_ORDER_RESERVED' // pré-pedido com reserva autorizada
  | 'OPPORTUNITY' // cotação/pré-pedido sem reserva — não reduz disponibilidade
  | 'CANCELLED'
  | 'FULFILLED' // atendido/entregue — saída já ocorreu
  | 'IGNORED'
  | 'UNMAPPED'; // situação sem regra configurada → tratada de forma conservadora

/** O saldo físico do Bling já reflete a saída deste pedido? */
export type StockEffect = 'NOT_POSTED' | 'POSTED' | 'UNKNOWN';
/** O saldo virtual do Bling já desconta este pedido? */
export type VirtualEffect = 'REFLECTED' | 'NOT_REFLECTED' | 'UNKNOWN';

export interface DepositBalance {
  depositId: number;
  depositName: string;
  physical: number | null;
  virtual: number | null;
  fetchedAt: Date | null;
  /** Depósitos marcados como "desconsiderar saldo" no Bling não entram na disponibilidade. */
  ignoreBalance: boolean;
  isDefault: boolean;
}

export interface OrderCommitment {
  orderId: number;
  orderNumber: number | null;
  itemId: number;
  customerId: number | null;
  customerName: string | null;
  sellerId: number | null;
  situationId: number | null;
  situationName: string | null;
  category: CommitmentCategory;
  stockEffect: StockEffect;
  virtualEffect: VirtualEffect;
  quantity: number;
  /** Unidades já entregues fisicamente (controle complementar). */
  quantityDelivered: number;
  /** Unidades liberadas do compromisso (ex.: cliente desistiu de parte). */
  quantityReleased: number;
  /** As unidades entregues já foram baixadas no Bling (lançamento parcial)? */
  deliveredStockPosted: boolean;
  depositId: number | null;
  expectedDate: string | null;
  orderDate: string | null;
  /** Pedido cancelado que, em algum momento, foi observado com baixa de estoque. */
  previouslyPosted?: boolean;
}

export type ReservationStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'RELEASED'
  | 'CONVERTED';

export interface LocalReservation {
  id: string;
  quantity: number;
  depositId: number | null;
  status: ReservationStatus;
  expiresAt: Date;
  customerId: number | null;
  customerName: string | null;
  sellerName: string | null;
  sellerUserId: string;
  blingOrderId: number | null;
  reason: string;
}

export type BlockReason = 'AVARIA' | 'CONFERENCIA' | 'ENTRADA_NAO_RECEBIDA' | 'DECISAO_OPERACIONAL';

export interface OperationalBlock {
  id: string;
  quantity: number;
  depositId: number | null;
  reasonType: BlockReason;
  notes: string | null;
}

export interface IncomingEntry {
  purchaseOrderId: number;
  purchaseOrderNumber: number | null;
  quantity: number;
  expectedDate: string | null;
  supplierName: string | null;
}

export type ExpiredReservationPolicy = 'KEEP_UNTIL_REVIEW' | 'AUTO_RELEASE';

export interface EngineSettings {
  baseMode: BaseMode;
  /** Idade máxima (minutos) do saldo para considerar a resposta atualizada. */
  maxBalanceAgeMinutes: number;
  expiredReservationPolicy: ExpiredReservationPolicy;
}

export interface SyncHealth {
  /** A última tentativa de sincronização de estoque/pedidos falhou? */
  lastSyncFailed: boolean;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

export interface EngineInput {
  product: { id: number; sku: string | null; name: string; unit?: string | null };
  balances: DepositBalance[];
  commitments: OrderCommitment[];
  reservations: LocalReservation[];
  blocks: OperationalBlock[];
  incoming: IncomingEntry[];
  settings: EngineSettings;
  sync: SyncHealth;
  now: Date;
}

/** Como cada linha foi tratada no cálculo. */
export type Treatment =
  | 'SUBTRACTED' // reduziu a disponibilidade
  | 'ALREADY_IN_BASE' // já estava descontado no saldo-base (não subtrai de novo)
  | 'NOT_COUNTED' // não compromete estoque (cotação, cancelado, pendente...)
  | 'SUPERSEDED'; // reserva substituída pelo pedido do Bling vinculado

export type LineKind = 'ORDER' | 'RESERVATION' | 'BLOCK';

export interface ExplanationLine {
  kind: LineKind;
  refId: string;
  label: string;
  depositId: number | null;
  depositAssumed: boolean;
  quantity: number;
  /** Quantidade efetivamente subtraída por esta linha. */
  subtracted: number;
  treatment: Treatment;
  bucket: DeductionBucket | null;
  reason: string;
  customerName: string | null;
  sellerId: number | null;
  sellerUserId: string | null;
  situationName: string | null;
  orderNumber: number | null;
  orderId: number | null;
  expiresAt: string | null;
  uncertain: boolean;
}

export type DeductionBucket =
  | 'committedOrders' // pedidos pagos/confirmados ainda não baixados
  | 'preOrderReservations' // pré-pedidos do Bling com reserva válida
  | 'localReservations' // reservas do módulo complementar
  | 'blocked' // bloqueios operacionais
  | 'uncertain'; // compromissos com efeito desconhecido (descontados por precaução)

export type Deductions = Record<DeductionBucket, number>;

export type AvailabilityStatus = 'CONFIRMED' | 'UNCONFIRMED';

export interface Issue {
  code:
    | 'NO_BALANCE'
    | 'STALE_BALANCE'
    | 'SYNC_FAILED'
    | 'UNMAPPED_SITUATION'
    | 'UNKNOWN_STOCK_EFFECT'
    | 'NEGATIVE_BALANCE'
    | 'OVERCOMMITTED'
    | 'POSSIBLE_DUPLICATE'
    | 'EXPIRED_RESERVATION'
    | 'CANCELLED_WITH_ACTIVE_RESERVATION'
    | 'CANCELLED_AFTER_POSTING'
    | 'DEPOSIT_ASSUMED'
    | 'PARTIAL_DELIVERY_NOT_POSTED'
    | 'KIT_FROM_COMPONENTS';
  severity: 'info' | 'warning' | 'critical';
  /** Se verdadeiro, impede a disponibilidade de ser "confirmada". */
  blocksConfirmation: boolean;
  message: string;
  refId?: string;
}

export interface DepositAvailability {
  depositId: number;
  depositName: string;
  ignored: boolean;
  physical: number | null;
  virtual: number | null;
  base: number | null;
  deductions: Deductions;
  available: number | null;
  availableForSale: number;
  fetchedAt: string | null;
}

export interface AvailabilityResult {
  product: { id: number; sku: string | null; name: string; unit?: string | null };
  baseMode: BaseMode;
  physicalTotal: number | null;
  virtualTotal: number | null;
  base: number | null;
  deductions: Deductions;
  totalDeducted: number;
  /** Pode ser negativo: indica compromissos acima do saldo. */
  available: number | null;
  /** Quantidade que pode ser oferecida (nunca negativa). */
  availableForSale: number;
  status: AvailabilityStatus;
  issues: Issue[];
  lines: ExplanationLine[];
  byDeposit: DepositAvailability[];
  incoming: IncomingEntry[];
  incomingTotal: number;
  opportunitiesTotal: number;
  dataAsOf: string | null;
  calculatedAt: string;
}

export interface SaleCheck {
  requested: number;
  /** null quando a disponibilidade não pode ser confirmada. */
  possible: boolean | null;
  remainingAfterSale: number | null;
  shortfall: number;
  message: string;
}
