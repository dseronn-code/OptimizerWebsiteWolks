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
  parentId: number | null;
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
  // inclui produtos-pai com variações (formato V): o código deles precisa ser reconhecido para listar as variações
  const { rows } = await pool.query("SELECT id, parent_id, sku, name, format, active FROM products WHERE kind = 'P' OR format = 'V'");
  const items = rows.map((r) => {
    const nameNorm = normalize(r.name);
    return { id: Number(r.id), parentId: r.parent_id ? Number(r.parent_id) : null, sku: r.sku, name: r.name, format: r.format, active: r.active, skuNorm: normalize(r.sku), nameNorm, tokens: nameNorm.split(' ').filter(Boolean) };
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
    if (p.format === 'V') continue; // pai de variações não tem estoque próprio; só aparece via findExactSku
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

const toMatch = (p: CachedProduct, score: number): ProductMatch => ({ id: p.id, sku: p.sku, name: p.name, format: p.format, active: p.active, score });

/** O texto parece um código (SKU): uma "palavra" só, com dígito. Ex.: "ostt-061545", "W0956/00", "1270". */
export function looksLikeCode(term: string): boolean {
  const t = term.trim();
  return /\d/.test(t) && !/\s/.test(t) && t.length >= 3;
}

/**
 * Código digitado exatamente igual a um SKU. Se for o pai de um produto com variações, devolve as variações.
 */
export async function findExactSku(term: string): Promise<{ product: ProductMatch } | { variations: ProductMatch[]; parent: ProductMatch } | null> {
  const q = normalize(term);
  if (!q) return null;
  const products = await loadProducts();
  const exact = products.filter((p) => p.skuNorm === q);
  if (!exact.length) return null;
  const real = exact.filter((p) => p.format !== 'V');
  const activeFirst = (a: CachedProduct, b: CachedProduct) => Number(b.active) - Number(a.active);
  if (real.length) return { product: toMatch(real.sort(activeFirst)[0], 1) };
  const parent = exact[0];
  const variations = products.filter((p) => p.parentId === parent.id && p.format !== 'V').sort((a, b) => Number(b.active) - Number(a.active) || (a.sku ?? '').localeCompare(b.sku ?? ''));
  if (variations.length === 1) return { product: toMatch(variations[0], 1) };
  return { variations: variations.map((v) => toMatch(v, 1)), parent: toMatch(parent, 1) };
}

/** Códigos parecidos com um código que não existe (erro de digitação, dígito a mais/a menos). */
export async function similarSkus(term: string, limit = 6): Promise<ProductMatch[]> {
  const q = normalize(term).replace(/ /g, '');
  if (q.length < 3) return [];
  const products = await loadProducts();
  const out: ProductMatch[] = [];
  for (const p of products) {
    if (p.format === 'V' || !p.skuNorm) continue;
    const sku = p.skuNorm.replace(/ /g, '');
    const maxLen = Math.max(sku.length, q.length);
    let score = 0;
    if (sku.startsWith(q) || q.startsWith(sku)) score = Math.min(sku.length, q.length) / maxLen;
    const d = levenshtein(q, sku);
    if (d <= Math.max(2, Math.floor(maxLen / 5))) score = Math.max(score, 1 - d / maxLen);
    if (score >= 0.6) out.push(toMatch(p, Math.round(score * 100) / 100));
  }
  return out.sort((a, b) => b.score - a.score || Number(b.active) - Number(a.active) || (a.sku ?? '').localeCompare(b.sku ?? '')).slice(0, limit);
}
