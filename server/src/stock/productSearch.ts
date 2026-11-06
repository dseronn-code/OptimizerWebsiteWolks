import { pool } from '../db/pool.js';
import { levenshtein, normalize, trigramSimilarity } from '../lib/text.js';

export interface ProductMatch {
  id: number;
  sku: string | null;
  name: string;
  format: string;
  active: boolean;
  score: number;
  /** preenchidos quando a lista é mostrada como opções para escolher */
  available?: number;
  incoming?: number;
  unit?: string | null;
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
  dims: string[];
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
    const nameSplit = normalize(String(r.name).replace(/(\d)\s*[x×*]\s*(?=\d)/gi, '$1 x '));
    return { id: Number(r.id), parentId: r.parent_id ? Number(r.parent_id) : null, sku: r.sku, name: r.name, format: r.format, active: r.active, skuNorm: normalize(r.sku), nameNorm: nameSplit, tokens: nameSplit.split(' ').filter(Boolean), dims: dimensions(r.name) };
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

/** Palavras da pergunta que não descrevem o produto. */
const QUERY_STOPWORDS = new Set(
  `qual quais quanto quantos quantas quando onde como tem temos ha existe a o as os um uma de do da dos das no na nos nas em para pra com
   e ou que previsao previsto prevista chega chegar chegada entrada entradas estoque disponivel disponiveis preco valor tamanho tamanhos
   modelo modelos tipo tipos me mostra mostre ver sobre esse este desse deste produto produtos item itens sku codigo voce voces nos`.split(/\s+/),
);

/** "12U X 600 X 600mm", "600x600", "12 u" → medidas normalizadas: ['12u', '600', '600']. */
export function dimensions(text: string): string[] {
  const t = normalize(text.replace(/(\d)\s*[x×*]\s*(?=\d)/gi, '$1 x '));
  const out: string[] = [];
  const re = /(?:^|\s)(\d+(?:[.,]\d+)?)\s?(u|mm|cm|m|mts|metros?|vias|pol|w|v|a|kg|gb)?(?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const unit = m[2] ?? '';
    // "mm/cm" são medidas comuns: comparamos só o número; "U" (altura de rack) e outras unidades ficam no valor
    out.push(['mm', 'cm', ''].includes(unit) ? m[1] : `${m[1]}${unit.replace(/^(mts|metros?|m)$/, 'm')}`);
    re.lastIndex -= 1;
  }
  return out;
}

/** Todas as medidas pedidas aparecem no produto, respeitando repetições (600 × 600 exige dois 600). */
function hasAllDimensions(wanted: string[], have: string[]): boolean {
  const pool = [...have];
  for (const w of wanted) {
    const i = pool.indexOf(w);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

/**
 * Busca tolerante a erros de digitação e nomes incompletos.
 * Prioriza SKU exato, depois SKU por prefixo, depois correspondência por palavras/trigramas.
 * Medidas na busca (12U, 600 x 600…) são obrigatórias: produto com outras medidas não aparece.
 */
export async function searchProducts(term: string, limit = 8): Promise<ProductMatch[]> {
  const wantedDims = dimensions(term);
  const q = normalize(term.replace(/(\d)\s*[x×*]\s*(?=\d)/gi, '$1 x '))
    .split(' ')
    .filter((w) => w && !QUERY_STOPWORDS.has(w))
    .join(' ');
  if (!q) return [];
  const qTokens = q.split(' ').filter((t) => t.length > 1);
  // palavras que descrevem o produto (sem medidas e sem o "x" de 600 x 600): todas precisam aparecer
  const words = qTokens.filter((t) => !/^\d/.test(t) && t !== 'x');
  const stem = (w: string) => w.replace(/(oes|aes|es|s)$/, '');
  const hasWord = (p: CachedProduct, w: string) =>
    // termo técnico com número (IP65, M8, CAT6) precisa ser igual: IP55 não serve para quem pediu IP65
    /\d/.test(w)
      ? p.tokens.includes(w) || p.skuNorm.split(' ').includes(w)
      : tokenScore(w, p.tokens) >= 0.75 || p.tokens.some((t) => stem(t) === stem(w)) || (w.length >= 4 && p.nameNorm.includes(w)) || p.skuNorm.includes(w);
  const products = await loadProducts();

  const run = (strict: boolean) => {
    const scored: ProductMatch[] = [];
    for (const p of products) {
      if (p.format === 'V') continue; // pai de variações não tem estoque próprio; só aparece via findExactSku
      if (wantedDims.length && !hasAllDimensions(wantedDims, p.dims)) continue;
      if (strict && words.length && !words.every((w) => hasWord(p, w))) continue;
      let score = 0;
      if (p.skuNorm && p.skuNorm === q) score = 1;
      else if (p.skuNorm && q.length >= 2 && p.skuNorm.startsWith(q)) score = 0.92;
      else if (p.skuNorm && qTokens.includes(p.skuNorm)) score = 0.95;
      else {
        const tokenAvg = qTokens.length ? qTokens.reduce((s, t) => s + tokenScore(t, p.tokens), 0) / qTokens.length : 0;
        const tri = trigramSimilarity(q, p.nameNorm);
        const contains = p.nameNorm.includes(q) ? 0.85 : 0;
        score = Math.max(tokenAvg * 0.9, tri, contains);
        // na busca estrita, todas as palavras e medidas já bateram: é um candidato forte
        if (strict && (words.length || wantedDims.length)) score = Math.max(score, 0.8);
      }
      // medidas batendo exatamente (sem medidas a mais) valem um pouco mais
      if (wantedDims.length && p.dims.length === wantedDims.length) score = Math.min(1, score + 0.05);
      if (!p.active) score *= 0.8;
      if (score >= 0.35) scored.push({ id: p.id, sku: p.sku, name: p.name, format: p.format, active: p.active, score: Math.round(score * 100) / 100 });
    }
    // empate: o modelo base (código que é o começo de outros, ex.: OSTT-061260 de -ESP/-GLM) antes das variações
    const skus = scored.map((x) => normalize(x.sku));
    const isBase = (x: ProductMatch) => {
      const k = normalize(x.sku);
      return k ? skus.some((o) => o !== k && o.startsWith(`${k} `)) : false;
    };
    return scored.sort((a, b) => b.score - a.score || Number(isBase(b)) - Number(isBase(a)) || (a.sku ?? '').localeCompare(b.sku ?? ''));
  };

  // primeiro exige todas as palavras; se nada bater (palavra a mais, erro grosseiro), afrouxa
  const strict = run(true);
  return (strict.length ? strict : run(false)).slice(0, limit);
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
