export type Role = 'vendedor' | 'gestor' | 'admin';

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  blingSellerId: number | null;
}

export interface Deductions {
  committedOrders: number;
  preOrderReservations: number;
  localReservations: number;
  blocked: number;
  uncertain: number;
}

export interface Issue {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  blocksConfirmation: boolean;
  message: string;
}

export interface ExplanationLine {
  kind: 'ORDER' | 'RESERVATION' | 'BLOCK';
  refId: string;
  label: string;
  depositId: number | null;
  depositAssumed: boolean;
  quantity: number;
  subtracted: number;
  treatment: 'SUBTRACTED' | 'ALREADY_IN_BASE' | 'NOT_COUNTED' | 'SUPERSEDED';
  bucket: keyof Deductions | null;
  reason: string;
  customerName: string | null;
  situationName: string | null;
  orderNumber: number | null;
  orderId: number | null;
  expiresAt: string | null;
  uncertain: boolean;
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

export interface Availability {
  product: { id: number; sku: string | null; name: string; unit?: string | null };
  baseMode: 'PHYSICAL' | 'VIRTUAL';
  physicalTotal: number | null;
  virtualTotal: number | null;
  base: number | null;
  deductions: Deductions;
  totalDeducted: number;
  available: number | null;
  availableForSale: number;
  status: 'CONFIRMED' | 'UNCONFIRMED';
  issues: Issue[];
  lines: ExplanationLine[];
  byDeposit: DepositAvailability[];
  incoming: { purchaseOrderId: number; purchaseOrderNumber: number | null; quantity: number; expectedDate: string | null; supplierName: string | null }[];
  incomingTotal: number;
  opportunitiesTotal: number;
  dataAsOf: string | null;
  calculatedAt: string;
  kit: null | { availableForSale: number; status: string; components: { componentId: number; sku: string | null; name: string; quantityPerKit: number; availableForSale: number; status: string }[] };
  refreshed: boolean;
  refreshError: string | null;
  dataSource: 'bling' | 'demo';
}

export interface SaleCheck {
  requested: number;
  possible: boolean | null;
  remainingAfterSale: number | null;
  shortfall: number;
  message: string;
}

export interface ProductMatch {
  id: number;
  sku: string | null;
  name: string;
  format: string;
  active: boolean;
  score: number;
}

export type Card =
  | { type: 'availability'; data: Availability; sale?: SaleCheck }
  | { type: 'candidates'; data: ProductMatch[] }
  | { type: 'table'; title: string; columns: string[]; rows: (string | number | null)[][] };

export interface ChatAnswer {
  answer: string;
  cards: Card[];
  engine: 'llm' | 'local';
  lastProductId: number | null;
}
