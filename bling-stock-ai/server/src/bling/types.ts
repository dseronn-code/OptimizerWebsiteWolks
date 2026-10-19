/**
 * Subconjunto dos contratos da API Bling v3 efetivamente usados pelo sistema.
 * Campos conferidos com a especificação pública (ver docs/MAPEAMENTO_API_BLING.md).
 * Todos os campos opcionais são tratados de forma defensiva.
 */

export interface BlingPage<T> {
  data: T[];
}

export interface BlingProductSummary {
  id: number;
  idProdutoPai?: number | null;
  nome: string;
  codigo?: string | null;
  tipo?: string;
  situacao?: 'A' | 'I' | string;
  formato?: 'S' | 'V' | 'E' | string;
  estoque?: { saldoVirtualTotal?: number };
}

export interface BlingProductDetail extends BlingProductSummary {
  unidade?: string | null;
  gtin?: string | null;
  estrutura?: {
    componentes?: { produto: { id: number }; quantidade: number }[];
  };
  variacoes?: BlingProductSummary[];
}

export interface BlingDeposit {
  id: number;
  descricao: string;
  situacao?: number;
  padrao?: boolean;
  desconsiderarSaldo?: boolean;
}

export interface BlingBalance {
  produto: { id: number; codigo?: string };
  saldoFisicoTotal: number;
  saldoVirtualTotal: number;
  depositos?: { id: number; saldoFisico: number; saldoVirtual: number }[];
}

export interface BlingSalesOrderSummary {
  id: number;
  numero?: number;
  data?: string;
  dataSaida?: string;
  dataPrevista?: string;
  total?: number;
  contato?: { id: number; nome?: string };
  situacao?: { id: number; valor?: number };
  loja?: { id: number };
}

export interface BlingSalesOrderDetail extends BlingSalesOrderSummary {
  itens?: {
    id: number;
    codigo?: string;
    unidade?: string;
    quantidade: number;
    descricao?: string;
    produto?: { id: number };
  }[];
  vendedor?: { id: number };
  transporte?: { contato?: { id?: number; nome?: string } };
}

export interface BlingPurchaseOrderSummary {
  id: number;
  numero?: number;
  data?: string;
  dataPrevista?: string;
  fornecedor?: { id: number; nome?: string };
  situacao?: { id?: number; valor: number };
}

export interface BlingPurchaseOrderDetail extends BlingPurchaseOrderSummary {
  itens?: {
    descricao?: string;
    quantidade?: number;
    produto?: { id: number; codigo?: string };
  }[];
}

export interface BlingModule {
  id: number;
  nome: string;
  descricao?: string;
}

export interface BlingSituation {
  id: number;
  nome: string;
  idHerdado?: number;
}

export interface ListSalesOrdersParams {
  pagina: number;
  limite?: number;
  dataAlteracaoInicial?: string;
  dataAlteracaoFinal?: string;
  idsSituacoes?: number[];
}

export interface ListPurchaseOrdersParams {
  pagina: number;
  limite?: number;
  valorSituacao?: number;
}

export interface ListProductsParams {
  pagina: number;
  limite?: number;
  criterio?: number;
  dataAlteracaoInicial?: string;
}

/** Interface do cliente — implementada pelo cliente HTTP real e pelo simulador (demo/testes). */
export interface BlingClient {
  readonly kind: 'http' | 'demo';
  listProducts(p: ListProductsParams): Promise<BlingProductSummary[]>;
  getProduct(id: number): Promise<BlingProductDetail | null>;
  listDeposits(pagina: number): Promise<BlingDeposit[]>;
  getBalances(productIds: number[]): Promise<BlingBalance[]>;
  listSalesOrders(p: ListSalesOrdersParams): Promise<BlingSalesOrderSummary[]>;
  getSalesOrder(id: number): Promise<BlingSalesOrderDetail | null>;
  listPurchaseOrders(p: ListPurchaseOrdersParams): Promise<BlingPurchaseOrderSummary[]>;
  getPurchaseOrder(id: number): Promise<BlingPurchaseOrderDetail | null>;
  listModules(): Promise<BlingModule[]>;
  listModuleSituations(moduleId: number): Promise<BlingSituation[]>;
}

export class BlingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'BlingApiError';
  }
}
