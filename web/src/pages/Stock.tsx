import { ArrowDown, ArrowUp, Boxes, CircleCheckBig, Download, Lock, Package, Search, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { ErrorMsg, PageHeader, Tile } from '../components/ui';
import { dateTime, num, plural } from '../format';

interface Row {
  id: number;
  sku: string | null;
  name: string;
  unit: string | null;
  physical: number | null;
  committed: number;
  availableForSale: number;
  incoming: number;
  status: 'CONFIRMED' | 'UNCONFIRMED';
  issues: string[];
  fetchedAt: string | null;
}

interface Resp {
  totals: { products: number; physical: number; negative: number; negativeProducts: number; committed: number; availableForSale: number; virtualKits: number; uncovered: number; uncoveredProducts: number };
  counts: Record<string, number>;
  page: number;
  pageSize: number;
  rows: Row[];
}

const FILTERS: [string, string][] = [
  ['all', 'Todos'],
  ['available', 'Com disponível'],
  ['out', 'Sem disponível'],
  ['committed', 'Comprometidos'],
  ['incoming', 'Com entrada prevista'],
  ['negative', 'Saldo negativo'],
  ['unconfirmed', 'Não confirmados'],
];

type SortKey = 'sku' | 'name' | 'physical' | 'committed' | 'availableForSale' | 'incoming';

const ISSUE_LABEL: Record<string, string> = {
  NEGATIVE_BALANCE: 'saldo negativo no Bling',
  OVERCOMMITTED: 'pedidos acima do estoque',
  STALE_BALANCE: 'saldo desatualizado',
  SYNC_FAILED: 'falha de sincronização',
  UNMAPPED_SITUATION: 'situação sem regra',
  UNKNOWN_STOCK_EFFECT: 'baixa desconhecida',
  POSSIBLE_DUPLICATE: 'possível duplicidade',
  NO_BALANCE: 'sem saldo',
  EXPIRED_RESERVATION: 'reserva vencida',
  CANCELLED_WITH_ACTIVE_RESERVATION: 'cancelado com reserva ativa',
  CANCELLED_AFTER_POSTING: 'cancelado após baixa',
  PARTIAL_DELIVERY_NOT_POSTED: 'entrega sem baixa',
};

export default function Stock() {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [depositId, setDepositId] = useState('');
  const [deposits, setDeposits] = useState<{ id: number; name: string; ignore_balance: boolean }[]>([]);
  const [sort, setSort] = useState<SortKey>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ deposits: typeof deposits }>('/api/deposits').then((r) => setDeposits(r.deposits)).catch(() => undefined);
  }, []);

  // espera o usuário parar de digitar
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = { q: query, filter, depositId, sort, dir };
  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<Resp>(`/api/stock${qs({ ...params, page, pageSize: 50 })}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filter, depositId, sort, dir, page]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setDir(key === 'sku' || key === 'name' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const pages = data ? Math.max(1, Math.ceil(data.totals.products / data.pageSize)) : 1;

  const SortHead = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <button className={`inline-flex items-center gap-1 uppercase ${right ? 'justify-end' : ''} ${sort === k ? 'text-brand-700' : ''}`} onClick={() => toggleSort(k)}>
      {label}
      {sort === k && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8 sm:py-8">
      <PageHeader
        icon={Boxes}
        title="Estoque"
        subtitle="Todos os produtos: estoque físico do Bling, o que já está comprometido em pedidos e o disponível para vender"
        actions={
          <a className="btn-secondary" href={`/api/stock${qs({ ...params, format: 'csv' })}`}>
            <Download size={16} /> Baixar planilha
          </a>
        }
      />

      <div className="card space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Buscar por nome ou SKU…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto" />
          </div>
          <select className="input" value={depositId} onChange={(e) => { setDepositId(e.target.value); setPage(1); }} aria-label="Depósito">
            <option value="">Todos os depósitos</option>
            {deposits.filter((d) => !d.ignore_balance).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setFilter(k); setPage(1); }}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition ${filter === k ? 'bg-brand-600 text-white shadow-[var(--shadow-glow)] ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200'}`}
            >
              {label}
              {data?.counts[k] !== undefined && <span className={`ml-1 text-xs ${filter === k ? 'text-brand-100' : 'text-slate-400'}`}>{num(data.counts[k])}</span>}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Produtos" value={num(data.totals.products)} tone="brand" icon={Package} />
          <Tile label="Físico em estoque (Bling)" value={num(data.totals.physical)} tone="muted" icon={Warehouse} />
          <Tile label="Comprometido (pedidos e reservas)" value={num(data.totals.committed)} tone="warn" icon={Lock} />
          <Tile label="Disponível para venda" value={num(data.totals.availableForSale)} tone="good" icon={CircleCheckBig} />
        </div>
      )}

      {data && (data.totals.negativeProducts > 0 || data.totals.virtualKits > 0 || data.totals.uncoveredProducts > 0) && (
        <p className="rounded-xl bg-white/60 px-4 py-3 text-xs leading-relaxed text-slate-500 ring-1 ring-slate-200/70">
          Disponível = físico − comprometido, produto a produto, nunca abaixo de zero.
          {data.totals.uncoveredProducts > 0 && <> Em {data.totals.uncoveredProducts === 1 ? '1 produto' : `${num(data.totals.uncoveredProducts)} produtos`}, os pedidos e reservas superam o estoque em {num(data.totals.uncovered)} un. (veja o filtro "Comprometidos"): {data.totals.uncoveredProducts === 1 ? 'ele fica' : 'eles ficam'} com 0 disponível, por isso o total disponível é {num(data.totals.uncovered)} un. maior que físico − comprometido.</>}
          {data.totals.negativeProducts > 0 && <> {data.totals.negativeProducts === 1 ? '1 produto está' : `${num(data.totals.negativeProducts)} produtos estão`} com saldo negativo no Bling (somando {num(data.totals.negative)} un.): {data.totals.negativeProducts === 1 ? 'ele conta' : 'eles contam'} como 0 disponível e não {data.totals.negativeProducts === 1 ? 'entra' : 'entram'} no físico acima.</>}
          {data.totals.virtualKits > 0 && <> {data.totals.virtualKits === 1 ? '1 kit calculado pelos componentes não entra' : `${num(data.totals.virtualKits)} kits calculados pelos componentes não entram`} nos totais, para as mesmas peças não serem contadas duas vezes.</>}
        </p>
      )}

      <ErrorMsg error={error} />

      <section className={`card overflow-hidden ${loading ? 'opacity-60' : ''}`}>
        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
          <tr>
            <th className="th"><SortHead k="sku" label="SKU" /></th>
            <th className="th"><SortHead k="name" label="Produto" /></th>
            <th className="th text-right"><SortHead k="physical" label="Físico" right /></th>
            <th className="th text-right"><SortHead k="committed" label="Comprometido" right /></th>
            <th className="th text-right"><SortHead k="availableForSale" label="Disponível" right /></th>
            <th className="th text-right"><SortHead k="incoming" label="A chegar" right /></th>
            <th className="th">Situação</th>
          </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
          {data?.rows.map((r) => (
            <tr key={r.id} className="hover:bg-brand-50/40">
              <td className="td whitespace-nowrap font-medium"><Link className="text-brand-600 hover:underline" to={`/produtos/${r.id}`}>{r.sku ?? '—'}</Link></td>
              <td className="td"><Link className="hover:underline" to={`/produtos/${r.id}`}>{r.name}</Link></td>
              <td className={`td text-right tabular-nums ${(r.physical ?? 0) < 0 ? 'font-semibold text-rose-600' : ''}`}>{num(r.physical)}</td>
              <td className="td text-right tabular-nums">{r.committed ? num(r.committed) : '—'}</td>
              <td className={`td text-right font-semibold tabular-nums ${r.availableForSale > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{num(r.availableForSale)}{r.unit ? <span className="ml-1 text-xs font-normal text-slate-400">{r.unit}</span> : null}</td>
              <td className="td text-right tabular-nums text-slate-500">{r.incoming ? num(r.incoming) : '—'}</td>
              <td className="td text-xs">
                {r.status === 'CONFIRMED' ? (
                  <span className="chip bg-emerald-50 text-emerald-700 ring-emerald-200">Confirmado</span>
                ) : (
                  <span className="flex flex-col items-start gap-1" title={r.issues.map((i) => ISSUE_LABEL[i] ?? i).join(', ')}>
                    <span className="chip bg-amber-50 text-amber-800 ring-amber-200">Não confirmado</span>
                    {r.issues.length > 0 && <span className="text-[11px] leading-snug text-slate-500">{r.issues.map((i) => ISSUE_LABEL[i] ?? i).filter(Boolean).slice(0, 2).join(' · ')}</span>}
                  </span>
                )}
              </td>
            </tr>
          ))}
          {data && data.rows.length === 0 && (
            <tr><td className="td py-8 text-center text-slate-500" colSpan={7}>Nenhum produto encontrado.</td></tr>
          )}
          </tbody>
        </table>
        </div>
      </section>

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span>
            Página {data.page} de {pages} · {plural(data.totals.products, 'produto', 'produtos')}
            {data.rows[0]?.fetchedAt && <> · saldos de {dateTime(data.rows[0].fetchedAt)}</>}
          </span>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
            <button className="btn-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</button>
          </div>
        </div>
      )}
    </div>
  );
}
