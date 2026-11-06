import { CheckCircle2, PackageCheck, ShoppingCart, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorMsg, PageHeader } from '../components/ui';
import { dateTime, num, PURCHASE_STATUS } from '../format';
import type { ProductMatch } from '../types';

interface PR {
  id: string;
  number: number;
  product_id: number | null;
  product_text: string;
  quantity: number;
  customer_name: string | null;
  notes: string | null;
  requested_by: string;
  requested_by_name: string;
  status: 'OPEN' | 'ORDERED' | 'RECEIVED' | 'REJECTED' | 'CANCELLED';
  manager_note: string | null;
  handled_by_name: string | null;
  handled_at: string | null;
  source: 'web' | 'whatsapp';
  created_at: string;
}

const CHIP: Record<PR['status'], string> = {
  OPEN: 'bg-amber-50 text-amber-800 ring-amber-200',
  ORDERED: 'bg-sky-50 text-sky-700 ring-sky-200',
  RECEIVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default function Purchases() {
  const { user } = useAuth();
  const manager = user?.role !== 'vendedor';
  const [params] = useSearchParams();
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<PR[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<{ requests: PR[] }>(`/api/purchase-requests${qs({ status })}`).then((r) => setRows(r.requests)).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const act = async (pr: PR, next: PR['status']) => {
    let managerNote: string | null = null;
    if (next === 'CANCELLED' && !confirm(`Cancelar a solicitação #${pr.number}?`)) return;
    if (next !== 'CANCELLED') {
      const n = prompt(`Marcar #${pr.number} como "${PURCHASE_STATUS[next]}". Observação para o vendedor (opcional):`, '');
      if (n === null) return;
      managerNote = n.trim() || null;
    }
    setError(null);
    await api.put(`/api/purchase-requests/${pr.id}`, { status: next, managerNote }).catch((e) => setError(e.message));
    await load();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-8 sm:py-8">
      <PageHeader
        icon={ShoppingCart}
        title="Solicitações de compra"
        subtitle={manager ? 'Pedidos de compra feitos pela equipe quando falta produto. Atualize o andamento: o vendedor é avisado.' : 'Peça a compra de um produto em falta e acompanhe o andamento. Nada é lançado no Bling.'}
      />

      <NewRequest preselect={params.get('produto') ? Number(params.get('produto')) : null} onCreated={load} />

      <div className="flex flex-wrap items-center gap-2">
        {[['', 'Todas'], ['OPEN', 'Abertas'], ['ORDERED', 'Compradas'], ['RECEIVED', 'Recebidas'], ['REJECTED', 'Recusadas'], ['CANCELLED', 'Canceladas']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setStatus(k)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 transition ${status === k ? 'bg-brand-600 text-white shadow-[var(--shadow-glow)] ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-brand-50 hover:text-brand-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <ErrorMsg error={error} />
      {rows.length === 0 ? (
        <Empty>Nenhuma solicitação de compra{status ? ' com esta situação' : ''}.</Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map((pr) => (
            <li key={pr.id} className="card card-hover flex flex-wrap items-start gap-4 p-4 sm:p-5">
              <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                <span className="text-[10px] font-semibold leading-none">Nº</span>
                <span className="text-sm font-bold leading-tight">{pr.number}</span>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${CHIP[pr.status]}`}>{PURCHASE_STATUS[pr.status]}</span>
                  <span className="font-semibold text-slate-900">{num(pr.quantity)} × {pr.product_text}</span>
                  {!pr.product_id && <span className="text-xs text-slate-400">(fora do cadastro)</span>}
                </div>
                <div className="text-sm text-slate-600">
                  {pr.customer_name && <>Cliente: <b>{pr.customer_name}</b> · </>}
                  {manager && <>Pedida por <b>{pr.requested_by_name}</b> · </>}
                  {dateTime(pr.created_at)}
                  {pr.source === 'whatsapp' && <span className="ml-1 text-xs text-emerald-700">· via WhatsApp</span>}
                </div>
                {pr.notes && <div className="text-sm text-slate-600">Obs.: {pr.notes}</div>}
                {pr.manager_note && <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200">Gestor{pr.handled_by_name ? ` (${pr.handled_by_name})` : ''}: {pr.manager_note}</div>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {manager && pr.status === 'OPEN' && <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => act(pr, 'ORDERED')}><ShoppingCart size={14} /> Comprado</button>}
                {manager && (pr.status === 'OPEN' || pr.status === 'ORDERED') && <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => act(pr, 'RECEIVED')}><PackageCheck size={14} /> Recebido</button>}
                {manager && pr.status === 'OPEN' && <button className="btn-secondary px-2.5 py-1.5 text-xs text-rose-600" onClick={() => act(pr, 'REJECTED')}><XCircle size={14} /> Recusar</button>}
                {pr.requested_by === user?.id && pr.status === 'OPEN' && <button className="btn-ghost px-2.5 py-1.5 text-xs text-rose-600" onClick={() => act(pr, 'CANCELLED')}>Cancelar</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewRequest({ preselect, onCreated }: { preselect: number | null; onCreated: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductMatch[]>([]);
  const [product, setProduct] = useState<{ id: number; label: string } | null>(null);
  const [quantity, setQuantity] = useState('');
  const [customer, setCustomer] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!preselect) return;
    api.get<{ availability: { product: { id: number; sku: string | null; name: string } } }>(`/api/products/${preselect}/availability`)
      .then((r) => setProduct({ id: r.availability.product.id, label: `${r.availability.product.sku ? `${r.availability.product.sku} — ` : ''}${r.availability.product.name}` }))
      .catch(() => undefined);
  }, [preselect]);

  useEffect(() => {
    if (product || q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => {
      api.get<{ results: ProductMatch[] }>(`/api/products/search${qs({ q })}`).then((r) => setResults(r.results)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, product]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      const r = await api.post<{ request: { number: number } }>('/api/purchase-requests', {
        productId: product?.id ?? null,
        productText: product ? null : q.trim(),
        quantity: Number(quantity.replace(',', '.')),
        customerName: customer.trim() || null,
        notes: notes.trim() || null,
      });
      setOk(`Solicitação #${r.request.number} enviada. O gestor foi avisado.`);
      setProduct(null);
      setQ('');
      setQuantity('');
      setCustomer('');
      setNotes('');
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h2 className="section-title">Nova solicitação</h2>
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="relative sm:col-span-3">
          <label className="label" htmlFor="pr-prod">Produto</label>
          {product ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm">
              <span className="truncate font-medium text-brand-800">{product.label}</span>
              <button type="button" className="text-xs text-brand-700 underline" onClick={() => setProduct(null)}>trocar</button>
            </div>
          ) : (
            <input id="pr-prod" className="input" required minLength={2} placeholder="SKU ou nome (pode ser um produto fora do cadastro)" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          {!product && results.length > 0 && (
            <div className="card absolute z-20 mt-1 w-full divide-y divide-slate-100 overflow-hidden shadow-[var(--shadow-lift)]">
              {results.map((p) => (
                <button type="button" key={p.id} className="block w-full px-4 py-2 text-left text-sm hover:bg-brand-50" onClick={() => { setProduct({ id: p.id, label: `${p.sku ? `${p.sku} — ` : ''}${p.name}` }); setResults([]); }}>
                  <span className="font-semibold text-brand-600">{p.sku ?? '—'}</span> · {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div><label className="label" htmlFor="pr-qty">Quantidade</label><input id="pr-qty" className="input" inputMode="decimal" required value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="pr-cli">Cliente (opcional)</label><input id="pr-cli" className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} /></div>
        <div className="sm:col-span-6"><label className="label" htmlFor="pr-obs">Observação para o comprador (opcional)</label><input id="pr-obs" className="input" placeholder="Prazo, marca, cor…" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <ErrorMsg error={error} />
      {ok && <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800"><CheckCircle2 size={16} /> {ok}</p>}
      <div className="flex justify-end"><button className="btn-primary" disabled={busy}><ShoppingCart size={16} /> {busy ? 'Enviando…' : 'Enviar solicitação'}</button></div>
    </form>
  );
}
