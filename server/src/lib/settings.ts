import type { Db } from '../db/pool.js';
import { pool } from '../db/pool.js';
import type { BaseMode, ExpiredReservationPolicy } from '../engine/types.js';

export interface AppSettings {
  /** 'demo' usa o simulador com dados fictícios; 'live' usa a API real do Bling. */
  appMode: 'demo' | 'live';
  engine: {
    baseMode: BaseMode;
    /** saldo mais antigo que isto deixa a disponibilidade "não confirmada" */
    maxBalanceAgeMinutes: number;
    /** em consultas críticas (posso vender X?), atualiza o saldo se for mais antigo que isto */
    criticalRefreshMinutes: number;
    /** pedidos não sincronizados há mais que isto deixam a disponibilidade "não confirmada" */
    ordersMaxAgeMinutes: number;
    expiredReservationPolicy: ExpiredReservationPolicy;
  };
  sync: {
    incrementalMinutes: number;
    reconcileMinutes: number;
    initialLookbackDays: number;
  };
  reservations: {
    defaultValidityHours: number;
    maxValidityDays: number;
    expiringSoonHours: number;
    /** se verdadeiro, reservas de vendedores entram ativas quando há saldo confirmado */
    autoApproveSellers: boolean;
  };
  privacy: {
    /** vendedores veem nomes de clientes de pedidos de outros vendedores */
    sellersSeeAllCustomers: boolean;
  };
  alerts: {
    staleOpportunityDays: number;
    committedWithoutPostingDays: number;
  };
  signup: {
    /** Mostra "Criar conta" na tela de login. */
    enabled: boolean;
    /** Conta nova só entra depois que um administrador aprovar. */
    requireApproval: boolean;
    /** Domínios de e-mail aceitos (ex.: ["itcomtech.com.br"]); vazio = qualquer domínio. */
    allowedDomains: string[];
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  appMode: 'demo',
  engine: {
    baseMode: 'PHYSICAL',
    maxBalanceAgeMinutes: 30,
    criticalRefreshMinutes: 5,
    ordersMaxAgeMinutes: 60,
    expiredReservationPolicy: 'KEEP_UNTIL_REVIEW',
  },
  sync: { incrementalMinutes: 10, reconcileMinutes: 60, initialLookbackDays: 120 },
  reservations: { defaultValidityHours: 48, maxValidityDays: 15, expiringSoonHours: 24, autoApproveSellers: false },
  privacy: { sellersSeeAllCustomers: false },
  alerts: { staleOpportunityDays: 5, committedWithoutPostingDays: 3 },
  signup: { enabled: true, requireApproval: true, allowedDomains: [] },
};

function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out as T;
}

let cache: { at: number; value: AppSettings } | null = null;

export async function getSettings(db: Db = pool): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  const { rows } = await db.query<{ value: unknown }>("SELECT value FROM settings WHERE key = 'app'");
  const value = merge(DEFAULT_SETTINGS, rows[0]?.value ?? {});
  cache = { at: Date.now(), value };
  return value;
}

export async function updateSettings(patch: Partial<AppSettings>, userId: string | null, db: Db = pool): Promise<AppSettings> {
  const current = await getSettings(db);
  const next = merge(current, patch);
  await db.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ('app', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), userId],
  );
  cache = null;
  return next;
}

export function clearSettingsCache() {
  cache = null;
}
