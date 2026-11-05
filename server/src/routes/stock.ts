import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, send } from '../auth/guard.js';
import { parse } from '../lib/http.js';
import { normalize } from '../lib/text.js';
import { stockOverview, type StockRow } from '../stock/overview.js';

const FILTERS = ['all', 'available', 'out', 'unconfirmed', 'negative', 'committed', 'incoming'] as const;
const SORTS = ['sku', 'name', 'physical', 'committed', 'availableForSale', 'incoming'] as const;

function matches(r: StockRow, filter: (typeof FILTERS)[number]): boolean {
  switch (filter) {
    case 'available':
      return r.availableForSale > 0;
    case 'out':
      return r.availableForSale <= 0;
    case 'unconfirmed':
      return r.status !== 'CONFIRMED';
    case 'negative':
      return (r.physical ?? 0) < 0;
    case 'committed':
      return r.committed > 0;
    case 'incoming':
      return r.incoming > 0;
    default:
      return true;
  }
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // evita fórmulas em planilhas (CSV injection) e escapa aspas
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function stockRoutes(app: FastifyInstance) {
  app.get('/api/stock', async (req, reply) => {
    requireUser(req);
    const q = parse(
      z.object({
        q: z.string().max(120).optional(),
        filter: z.enum(FILTERS).default('all'),
        depositId: z.coerce.number().int().positive().optional(),
        sort: z.enum(SORTS).default('name'),
        dir: z.enum(['asc', 'desc']).default('asc'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(10).max(200).default(50),
        format: z.enum(['json', 'csv']).default('json'),
      }),
      req.query,
    );
    const all = await stockOverview(q.depositId ?? null);
    const tokens = normalize(q.q).split(' ').filter(Boolean);
    let rows = all.filter((r) => matches(r, q.filter));
    if (tokens.length) {
      rows = rows.filter((r) => {
        const hay = normalize(`${r.sku ?? ''} ${r.name}`);
        return tokens.every((t) => hay.includes(t));
      });
    }
    const dir = q.dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const va = a[q.sort] ?? '';
      const vb = b[q.sort] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * dir;
    });

    if (q.format === 'csv') {
      const header = ['SKU', 'Produto', 'Unidade', 'Físico (Bling)', 'Comprometido', 'Disponível para venda', 'Entradas previstas', 'Status'];
      const lines = rows.map((r) =>
        [r.sku, r.name, r.unit, r.physical, r.committed, r.availableForSale, r.incoming, r.status === 'CONFIRMED' ? 'Confirmada' : 'Não confirmada']
          .map(csvCell)
          .join(';'),
      );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="estoque-${new Date().toISOString().slice(0, 10)}.csv"`)
        .header('cache-control', 'no-store')
        .send('﻿' + [header.join(';'), ...lines].join('\n'));
    }

    // Totais em unidades: kits virtuais ficam fora (as peças já estão nos componentes) e saldos
    // negativos são mostrados à parte — assim "disponível" nunca passa do estoque positivo.
    const totals = rows.reduce(
      (t, r) => {
        t.products += 1;
        if (r.virtualKit) {
          t.virtualKits += 1;
          return t;
        }
        const phys = r.physical ?? 0;
        if (phys >= 0) t.physical += phys;
        else {
          t.negative += phys;
          t.negativeProducts += 1;
        }
        t.committed += r.committed;
        t.availableForSale += r.availableForSale;
        // pedidos além do estoque: o produto fica com 0 disponível (nunca negativo), então
        // a soma do disponível não é exatamente físico − comprometido; a diferença é esta falta
        const uncovered = r.committed - Math.max(0, phys);
        if (uncovered > 0.00001) {
          t.uncovered += uncovered;
          t.uncoveredProducts += 1;
        }
        return t;
      },
      { products: 0, physical: 0, negative: 0, negativeProducts: 0, committed: 0, availableForSale: 0, virtualKits: 0, uncovered: 0, uncoveredProducts: 0 },
    );
    const counts = Object.fromEntries(FILTERS.map((f) => [f, all.filter((r) => matches(r, f)).length]));
    const start = (q.page - 1) * q.pageSize;
    totals.uncovered = Math.round(totals.uncovered * 10000) / 10000;
    return send(reply, { totals, counts, page: q.page, pageSize: q.pageSize, rows: rows.slice(start, start + q.pageSize) });
  });
}
