import { getBlingClient } from '../bling/clientFactory.js';
import { pool } from '../db/pool.js';
import { calculateAvailability, kitAvailability } from '../engine/availability.js';
import type { AvailabilityResult, ExplanationLine } from '../engine/types.js';
import { getSettings, type AppSettings } from '../lib/settings.js';
import { refreshBalances, recordAttempt } from '../sync/syncService.js';
import { getKitComponents, getProduct, loadBalances, loadEngineInput } from './repository.js';

export interface Viewer {
  id: string;
  role: 'vendedor' | 'gestor' | 'admin';
  blingSellerId: number | null;
}

export interface AvailabilityResponse extends AvailabilityResult {
  kit: null | {
    availableForSale: number;
    status: AvailabilityResult['status'];
    limitingComponentId: number | null;
    components: { componentId: number; sku: string | null; name: string; quantityPerKit: number; availableForSale: number; status: string }[];
  };
  refreshed: boolean;
  refreshError: string | null;
  dataSource: 'bling' | 'demo';
}

export interface AvailabilityOptions {
  /** 'critical': atualiza o saldo no Bling se estiver mais antigo que o limite configurado. */
  freshness?: 'critical' | 'cached';
  /** Simulação: desconsidera estes pedidos (ex.: "e se o cliente cancelar?"). */
  excludeOrderIds?: number[];
  viewer?: Viewer;
}

async function ensureFreshBalances(productIds: number[], settings: AppSettings): Promise<{ refreshed: boolean; error: string | null }> {
  const now = Date.now();
  const stale: number[] = [];
  for (const id of productIds) {
    const balances = await loadBalances(id);
    const oldest = balances.reduce<number | null>((m, b) => (b.fetchedAt ? Math.min(m ?? Infinity, b.fetchedAt.getTime()) : m), null);
    if (oldest === null || now - oldest > settings.engine.criticalRefreshMinutes * 60000) stale.push(id);
  }
  if (stale.length === 0) return { refreshed: false, error: null };
  try {
    const client = await getBlingClient();
    await recordAttempt('balances_on_demand', 'consulta', async () => ({ items: await refreshBalances(client, stale) }));
    return { refreshed: true, error: null };
  } catch (err) {
    return { refreshed: false, error: `Não foi possível atualizar o saldo no Bling agora: ${(err as Error).message}` };
  }
}

export async function getAvailability(productId: number, opts: AvailabilityOptions = {}): Promise<AvailabilityResponse | null> {
  const settings = await getSettings();
  const product = await getProduct(productId);
  if (!product) return null;
  const components = product.format === 'E' ? await getKitComponents(productId) : [];
  const ids = [productId, ...components.map((c) => c.component_id)];

  let refresh = { refreshed: false, error: null as string | null };
  if (opts.freshness === 'critical') refresh = await ensureFreshBalances(ids, settings);

  const compute = async (id: number) => {
    const input = await loadEngineInput(id, settings, new Date());
    if (!input) return null;
    if (opts.excludeOrderIds?.length) {
      input.commitments = input.commitments.filter((c) => !opts.excludeOrderIds!.includes(c.orderId));
    }
    if (refresh.error) {
      input.sync = { ...input.sync, lastSyncFailed: true, lastError: [input.sync.lastError, refresh.error].filter(Boolean).join('; ') };
    }
    return calculateAvailability(input);
  };

  const result = await compute(productId);
  if (!result) return null;

  let kit: AvailabilityResponse['kit'] = null;
  const kitComps: { componentId: number; quantityPerKit: number; result: AvailabilityResult; sku: string | null; name: string }[] = [];
  if (components.length) {
    const comps = kitComps;
    for (const c of components) {
      const r = await compute(c.component_id);
      const p = await getProduct(c.component_id);
      if (r && p) comps.push({ componentId: c.component_id, quantityPerKit: c.quantity, result: r, sku: p.sku, name: p.name });
    }
    const k = kitAvailability(comps);
    kit = {
      ...k,
      components: comps.map((c) => ({
        componentId: c.componentId,
        sku: c.sku,
        name: c.name,
        quantityPerKit: c.quantityPerKit,
        availableForSale: c.result.availableForSale,
        status: c.result.status,
      })),
    };
    if (comps.length < components.length) kit.status = 'UNCONFIRMED';
  }

  // Kit com composição: a disponibilidade vem dos componentes (pedidos do kit já são
  // descontados nos componentes), então o resultado do próprio kit é substituído.
  const comps = kitComps;
  const base: AvailabilityResult = kit
    ? {
        ...result,
        deductions: { committedOrders: 0, preOrderReservations: 0, localReservations: 0, blocked: 0, uncertain: 0 },
        totalDeducted: 0,
        available: kit.availableForSale,
        availableForSale: kit.availableForSale,
        status: kit.status,
        issues: [
          ...result.issues.filter((i) => i.code !== 'NO_BALANCE' && i.code !== 'OVERCOMMITTED'),
          { code: 'KIT_FROM_COMPONENTS', severity: 'info', blocksConfirmation: false, message: 'Kit com composição: disponibilidade calculada pelos componentes; pedidos do kit são descontados nos componentes.' },
        ],
        dataAsOf: comps.reduce<string | null>((m, c) => (c.result.dataAsOf && (!m || c.result.dataAsOf < m) ? c.result.dataAsOf : m), null),
        lines: result.lines.map((l) => (l.treatment === 'SUBTRACTED' ? { ...l, subtracted: 0, bucket: null, treatment: 'NOT_COUNTED', reason: 'Descontado nos componentes do kit.' } : l)),
      }
    : result;

  const response: AvailabilityResponse = {
    ...base,
    kit,
    refreshed: refresh.refreshed,
    refreshError: refresh.error,
    dataSource: product.source === 'demo' ? 'demo' : 'bling',
  };
  return opts.viewer ? applyPrivacy(response, opts.viewer, settings) : response;
}

/**
 * Vendedores só veem o nome do cliente dos próprios pedidos/reservas, salvo configuração em contrário.
 * O controle é aplicado no backend — o frontend nunca recebe o dado mascarado.
 */
export function canSeeCustomer(line: Pick<ExplanationLine, 'sellerId' | 'sellerUserId'>, viewer: Viewer, settings: AppSettings): boolean {
  if (viewer.role !== 'vendedor' || settings.privacy.sellersSeeAllCustomers) return true;
  if (line.sellerUserId && line.sellerUserId === viewer.id) return true;
  if (line.sellerId !== null && viewer.blingSellerId !== null && line.sellerId === viewer.blingSellerId) return true;
  return false;
}

export function applyPrivacy<T extends { lines: ExplanationLine[] }>(result: T, viewer: Viewer, settings: AppSettings): T {
  return {
    ...result,
    lines: result.lines.map((l) =>
      l.customerName && !canSeeCustomer(l, viewer, settings)
        ? { ...l, customerName: 'Cliente de outro vendedor', label: l.label.replace(/ — .*$/, ' — cliente de outro vendedor') }
        : l,
    ),
  };
}

export async function productSummaries(productIds: number[], viewer?: Viewer) {
  const out = [];
  for (const id of productIds) {
    const r = await getAvailability(id, { viewer });
    if (r) out.push(r);
  }
  return out;
}

export async function listProductIdsWithActivity(limit = 500): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT DISTINCT p.id FROM products p
     LEFT JOIN stock_balances b ON b.product_id = p.id
     WHERE p.active AND p.format <> 'V' AND b.product_id IS NOT NULL
     ORDER BY p.id LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}
