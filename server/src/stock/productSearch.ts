import { pool } from '../db/pool.js';
import { levenshtein, normalize, trigramSimilarity } from '../lib/text.js';

export interface ProductMatch {
  id: number;
  sku: string | null;
  name: string;
  format: string;
  active: boolean;
  score: number;
}

interface CachedProduct {
  id: number;
  sku: string | null;
  name: string;
  format: string;
  active: boolean;
  skuNorm: string;
  nameNorm: string;
  tokens: string[];
}

let cache: { at: number; items: CachedProduct[] } | null = null;

export function invalidateProductCache() {
  cache = null;
}

async function loadProducts(): Promise<CachedProduct[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.items;
  const { rows } = await pool.query("SELECT id, sku, name, format, active FROM products WHERE format <> 'V'");
  const items = rows.map((r) => {
    const nameNorm = normalize(r.name);
    return { ...r, skuNorm: normalize(r.sku), nameNorm, tokens: nameNorm.split(' ').filter(Boolean) };
  });
  cache = { at: Date.now(), items };
  return items;
}

function tokenScore(q: string, tokens: string[]): number {
  let best = 0;
  for (const t of tokens) {
    if (t === q) return 1;
    if (t.startsWith(q) && q.length >= 3) best = Math.max(best, 0.9);
    const maxLen = Math.max(t.length, q.length);
    if (maxLen >= 4) {
      const d = levenshtein(q, t);
      // tolera ~1 erro a cada 4 caracteres
      if (d <= Math.floor(maxLen / 4)) best = Math.max(best, 1 - d / maxLen);
    }
  }
  return best;
}

/**
 * Busca tolerante a erros de digitação e nomes incompletos.
 * Prioriza SKU exato, depois SKU por prefixo, depois correspondência por palavras/trigramas.
 */
export async function searchProducts(term: string, limit = 8): Promise<ProductMatch[]> {
  const q = normalize(term);
  if (!q) return [];
  const qTokens = q.split(' ').filter((t) => t.length > 1);
  const products = await loadProducts();
  const scored: ProductMatch[] = [];
  for (const p of products) {
    let score = 0;
    if (p.skuNorm && p.skuNorm === q) score = 1;
    else if (p.skuNorm && q.length >= 2 && p.skuNorm.startsWith(q)) score = 0.92;
    else if (p.skuNorm && qTokens.includes(p.skuNorm)) score = 0.95;
    else {
      const tokenAvg = qTokens.length ? qTokens.reduce((s, t) => s + tokenScore(t, p.tokens), 0) / qTokens.length : 0;
      const tri = trigramSimilarity(q, p.nameNorm);
      const contains = p.nameNorm.includes(q) ? 0.85 : 0;
      score = Math.max(tokenAvg * 0.9, tri, contains);
    }
    if (!p.active) score *= 0.8;
    if (score >= 0.35) scored.push({ id: p.id, sku: p.sku, name: p.name, format: p.format, active: p.active, score: Math.round(score * 100) / 100 });
  }
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}
