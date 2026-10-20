import { getSettings } from '../lib/settings.js';
import { FakeBlingClient } from './fakeClient.js';
import { HttpBlingClient } from './httpClient.js';
import { dbTokenProvider } from './oauth.js';
import type { BlingClient } from './types.js';
import { buildDemoBlingState } from '../demo/fixtures.js';

let override: BlingClient | null = null;
let demoClient: FakeBlingClient | null = null;
const httpClient = new HttpBlingClient(dbTokenProvider);

/** Testes podem substituir o cliente. */
export function setBlingClientOverride(c: BlingClient | null) {
  override = c;
}

export function getDemoClient(): FakeBlingClient {
  if (!demoClient) demoClient = new FakeBlingClient(buildDemoBlingState());
  return demoClient;
}

export async function getBlingClient(): Promise<BlingClient> {
  if (override) return override;
  const s = await getSettings();
  return s.appMode === 'demo' ? getDemoClient() : httpClient;
}
