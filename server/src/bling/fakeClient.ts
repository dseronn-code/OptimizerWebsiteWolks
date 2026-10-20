import type {
  BlingBalance,
  BlingClient,
  BlingDeposit,
  BlingModule,
  BlingProductDetail,
  BlingPurchaseOrderDetail,
  BlingSalesOrderDetail,
  BlingSituation,
  ListProductsParams,
  ListPurchaseOrdersParams,
  ListSalesOrdersParams,
} from './types.js';
import { BlingApiError } from './types.js';

export interface FakeBlingState {
  products: BlingProductDetail[];
  deposits: BlingDeposit[];
  /** saldo por produto e depósito */
  balances: { productId: number; depositId: number; physical: number; virtual: number }[];
  salesOrders: (BlingSalesOrderDetail & { alteradoEm?: string })[];
  purchaseOrders: BlingPurchaseOrderDetail[];
  modules: BlingModule[];
  situations: Record<number, BlingSituation[]>;
}

/**
 * Simulador da API Bling v3 com as mesmas formas de resposta do cliente HTTP.
 * Usado pelo ambiente de DEMONSTRAÇÃO (dados fictícios) e pelos testes automatizados.
 * Permite injetar falhas para testar retentativas e indisponibilidade.
 */
export class FakeBlingClient implements BlingClient {
  readonly kind = 'demo' as const;
  failNext: number = 0;
  failAll = false;
  calls: string[] = [];

  constructor(public state: FakeBlingState) {}

  private hit(name: string) {
    this.calls.push(name);
    if (this.failAll || this.failNext > 0) {
      if (this.failNext > 0) this.failNext--;
      throw new BlingApiError('Bling indisponível (simulado)', 503, true);
    }
  }

  private page<T>(items: T[], pagina: number, limite = 100): T[] {
    return items.slice((pagina - 1) * limite, pagina * limite);
  }

  async listProducts(p: ListProductsParams) {
    this.hit('listProducts');
    return this.page(this.state.products, p.pagina, p.limite).map(({ estrutura: _e, variacoes: _v, ...rest }) => rest);
  }
  async getProduct(id: number) {
    this.hit('getProduct');
    return structuredClone(this.state.products.find((p) => p.id === id) ?? null);
  }
  async listDeposits(pagina: number) {
    this.hit('listDeposits');
    return this.page(this.state.deposits, pagina);
  }
  async getBalances(productIds: number[]): Promise<BlingBalance[]> {
    this.hit('getBalances');
    const out: BlingBalance[] = [];
    for (const id of productIds) {
      const rows = this.state.balances.filter((b) => b.productId === id);
      if (rows.length === 0) continue;
      out.push({
        produto: { id, codigo: this.state.products.find((p) => p.id === id)?.codigo ?? undefined },
        saldoFisicoTotal: rows.reduce((s, r) => s + r.physical, 0),
        saldoVirtualTotal: rows.reduce((s, r) => s + r.virtual, 0),
        depositos: rows.map((r) => ({ id: r.depositId, saldoFisico: r.physical, saldoVirtual: r.virtual })),
      });
    }
    return out;
  }
  async listSalesOrders(p: ListSalesOrdersParams) {
    this.hit('listSalesOrders');
    let items = this.state.salesOrders;
    if (p.idsSituacoes?.length) items = items.filter((o) => o.situacao && p.idsSituacoes!.includes(o.situacao.id));
    if (p.dataAlteracaoInicial) items = items.filter((o) => (o.alteradoEm ?? o.data ?? '') >= p.dataAlteracaoInicial!.slice(0, 10));
    return this.page(items, p.pagina, p.limite).map(({ itens: _i, alteradoEm: _a, ...rest }) => rest);
  }
  async getSalesOrder(id: number) {
    this.hit('getSalesOrder');
    const o = this.state.salesOrders.find((x) => x.id === id);
    if (!o) return null;
    const { alteradoEm: _a, ...rest } = structuredClone(o);
    return rest;
  }
  async listPurchaseOrders(p: ListPurchaseOrdersParams) {
    this.hit('listPurchaseOrders');
    let items = this.state.purchaseOrders;
    if (p.valorSituacao !== undefined) items = items.filter((o) => o.situacao?.valor === p.valorSituacao);
    return this.page(items, p.pagina, p.limite).map(({ itens: _i, ...rest }) => rest);
  }
  async getPurchaseOrder(id: number) {
    this.hit('getPurchaseOrder');
    return structuredClone(this.state.purchaseOrders.find((x) => x.id === id) ?? null);
  }
  async listModules() {
    this.hit('listModules');
    return this.state.modules;
  }
  async listModuleSituations(moduleId: number) {
    this.hit('listModuleSituations');
    return this.state.situations[moduleId] ?? [];
  }
}
