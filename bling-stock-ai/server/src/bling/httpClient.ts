import { config } from '../config.js';
import type {
  BlingBalance,
  BlingClient,
  BlingDeposit,
  BlingModule,
  BlingProductDetail,
  BlingProductSummary,
  BlingPurchaseOrderDetail,
  BlingPurchaseOrderSummary,
  BlingSalesOrderDetail,
  BlingSalesOrderSummary,
  BlingSituation,
  ListProductsParams,
  ListPurchaseOrdersParams,
  ListSalesOrdersParams,
} from './types.js';
import { BlingApiError } from './types.js';

type Query = Record<string, string | number | undefined | (string | number)[]>;

export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** Força renovação após um 401. Retorna o novo token. */
  forceRefresh(): Promise<string>;
}

/**
 * Limitador simples por intervalo mínimo entre requisições, compartilhado no processo.
 * A API do Bling limita requisições por segundo e por dia por conta; o 429 também é tratado.
 */
class RateLimiter {
  private next = 0;
  constructor(private readonly perSecond: number) {}
  async wait(): Promise<void> {
    const interval = 1000 / this.perSecond;
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + interval;
    if (at > now) await sleep(at - now);
  }
  penalize(ms: number) {
    this.next = Math.max(this.next, Date.now() + ms);
  }
}

const limiter = new RateLimiter(config.BLING_REQUESTS_PER_SECOND);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${config.BLING_API_BASE_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined) continue;
    // A API v3 usa a notação "param[]" para listas (ex.: idsProdutos[]=1&idsProdutos[]=2).
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(`${k}[]`, String(item));
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export class HttpBlingClient implements BlingClient {
  readonly kind = 'http' as const;

  constructor(
    private readonly tokens: TokenProvider,
    private readonly opts: { maxRetries?: number; timeoutMs?: number } = {},
  ) {}

  private async request<T>(path: string, query?: Query): Promise<T | null> {
    const maxRetries = this.opts.maxRetries ?? 4;
    let token = await this.tokens.getAccessToken();
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      await limiter.wait();
      let res: Response;
      try {
        res = await fetch(buildUrl(path, query), {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20000),
        });
      } catch (err) {
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new BlingApiError(`Falha de rede ao consultar ${path}: ${(err as Error).message}`, 0, true);
      }
      if (res.status === 404) return null;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await this.tokens.forceRefresh();
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt);
        if (res.status === 429) limiter.penalize(wait);
        if (attempt < maxRetries) {
          await sleep(wait);
          continue;
        }
        throw new BlingApiError(`Bling respondeu ${res.status} em ${path}`, res.status, true, await safeJson(res));
      }
      if (!res.ok) {
        throw new BlingApiError(`Bling respondeu ${res.status} em ${path}`, res.status, false, await safeJson(res));
      }
      return (await res.json()) as T;
    }
  }

  private async list<T>(path: string, query: Query): Promise<T[]> {
    const body = await this.request<{ data?: T[] }>(path, query);
    return body?.data ?? [];
  }

  private async one<T>(path: string): Promise<T | null> {
    const body = await this.request<{ data?: T }>(path);
    return body?.data ?? null;
  }

  listProducts(p: ListProductsParams) {
    return this.list<BlingProductSummary>('produtos', { pagina: p.pagina, limite: p.limite ?? 100, criterio: p.criterio, dataAlteracaoInicial: p.dataAlteracaoInicial });
  }
  getProduct(id: number) {
    return this.one<BlingProductDetail>(`produtos/${id}`);
  }
  listDeposits(pagina: number) {
    return this.list<BlingDeposit>('depositos', { pagina, limite: 100 });
  }
  getBalances(productIds: number[]) {
    return this.list<BlingBalance>('estoques/saldos', { idsProdutos: productIds });
  }
  listSalesOrders(p: ListSalesOrdersParams) {
    return this.list<BlingSalesOrderSummary>('pedidos/vendas', {
      pagina: p.pagina,
      limite: p.limite ?? 100,
      dataAlteracaoInicial: p.dataAlteracaoInicial,
      dataAlteracaoFinal: p.dataAlteracaoFinal,
      idsSituacoes: p.idsSituacoes,
    });
  }
  getSalesOrder(id: number) {
    return this.one<BlingSalesOrderDetail>(`pedidos/vendas/${id}`);
  }
  listPurchaseOrders(p: ListPurchaseOrdersParams) {
    return this.list<BlingPurchaseOrderSummary>('pedidos/compras', { pagina: p.pagina, limite: p.limite ?? 100, valorSituacao: p.valorSituacao });
  }
  getPurchaseOrder(id: number) {
    return this.one<BlingPurchaseOrderDetail>(`pedidos/compras/${id}`);
  }
  listModules() {
    return this.list<BlingModule>('situacoes/modulos', {});
  }
  listModuleSituations(moduleId: number) {
    return this.list<BlingSituation>(`situacoes/modulos/${moduleId}`, {});
  }
}

function backoff(attempt: number) {
  return Math.min(30000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}
