import { CheckCircle2, Clock3, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { num } from '../format';
import type { ProductMatch } from '../types';
import { ErrorMsg } from './ui';

interface Item {
  key: number;
  product: { id: number; label: string; available: number; unit: string | null; confirmed: boolean } | null;
  quantity: string;
  result?: { ok: boolean; text: string; pending?: boolean };
}

let seq = 1;
const empty = (): Item => ({ key: seq++, product: null, quantity: '' });

/** Nova reserva com um ou mais itens para o mesmo cliente (cada item vira uma reserva). */
export default function NewReservation({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { user } = useAuth();
  const [customer, setCustomer] = useState('');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('48');
  const [items, setItems] = useState<Item[]>([empty()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = items.length > 0 && items.every((i) => i.result?.ok);

  const update = (key: number, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const valid = items.filter((i) => i.product && Number(i.quantity.replace(',', '.')) > 0);
    if (!valid.length) return setError('Inclua pelo menos um item com produto e quantidade.');
    setBusy(true);
    for (const it of valid) {
      if (it.result?.ok) continue;
      try {
        const r = await api.post<{ reservation: { status: string }; note: string | null }>('/api/reservations', {
          productId: it.product!.id,
          quantity: Number(it.quantity.replace(',', '.')),
          customerName: customer.trim(),
          reason: reason.trim() || 'Reserva pelo sistema',
          validityHours: Number(hours),
        });
        update(it.key, {
          result: r.reservation.status === 'ACTIVE'
            ? { ok: true, text: 'Reserva ativa' }
            : { ok: true, pending: true, text: r.note ?? 'Enviada para aprovação do gestor' },
        });
      } catch (err) {
        update(it.key, { result: { ok: false, text: (err as Error).message } });
      }
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="card mb-5 animate-fade-up space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Nova reserva</h2>
        <span className="text-xs text-slate-500">{user?.role === 'vendedor' ? 'Reservas podem precisar de aprovação do gestor.' : 'Reservas de gestores ficam ativas na hora, se houver saldo.'}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-3"><label className="label" htmlFor="nr-cli">Cliente / negociação</label><input id="nr-cli" className="input" required minLength={2} value={customer} onChange={(e) => setCustomer(e.target.value)} disabled={done} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="nr-mot">Motivo (opcional)</label><input id="nr-mot" className="input" placeholder="Ex.: aguardando pagamento" value={reason} onChange={(e) => setReason(e.target.value)} disabled={done} /></div>
        <div><label className="label" htmlFor="nr-val">Validade</label>
          <select id="nr-val" className="input" value={hours} onChange={(e) => setHours(e.target.value)} disabled={done}>
            <option value="24">24 horas</option><option value="48">48 horas</option><option value="72">72 horas</option><option value="168">7 dias</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="label">Itens</div>
        {items.map((it, idx) => (
          <ItemRow
            key={it.key}
            index={idx + 1}
            item={it}
            disabled={done || Boolean(it.result?.ok)}
            onChange={(patch) => update(it.key, patch)}
            onRemove={items.length > 1 && !it.result?.ok ? () => setItems((l) => l.filter((x) => x.key !== it.key)) : null}
          />
        ))}
        {!done && (
          <button type="button" className="btn-ghost px-2 text-sm text-brand-700" onClick={() => setItems((l) => [...l, empty()])}>
            <Plus size={16} /> Incluir item
          </button>
        )}
      </div>

      <ErrorMsg error={error} />
      <div className="flex flex-wrap justify-end gap-2">
        {done ? (
          <button type="button" className="btn-primary" onClick={onDone}><CheckCircle2 size={16} /> Concluir</button>
        ) : (
          <>
            <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
            <button className="btn-primary" disabled={busy}>{busy ? 'Reservando…' : `Reservar ${items.filter((i) => i.product).length > 1 ? `${items.filter((i) => i.product).length} itens` : ''}`.trim()}</button>
          </>
        )}
      </div>
    </form>
  );
}

function ItemRow({ index, item, disabled, onChange, onRemove }: { index: number; item: Item; disabled: boolean; onChange: (p: Partial<Item>) => void; onRemove: (() => void) | null }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductMatch[]>([]);

  useEffect(() => {
    if (item.product || q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => {
      api.get<{ results: ProductMatch[] }>(`/api/products/search${qs({ q })}`).then((r) => setResults(r.results.filter((p) => p.active))).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, item.product]);

  const pick = async (p: ProductMatch) => {
    setResults([]);
    setQ('');
    const r = await api.get<{ availability: { availableForSale: number; status: string; kit: { availableForSale: number } | null; product: { unit: string | null } } }>(`/api/products/${p.id}/availability`);
    const a = r.availability;
    onChange({ product: { id: p.id, label: `${p.sku ? `${p.sku} — ` : ''}${p.name}`, available: a.kit ? a.kit.availableForSale : a.availableForSale, unit: a.product.unit, confirmed: a.status === 'CONFIRMED' } });
  };

  const qty = Number(item.quantity.replace(',', '.'));
  const over = item.product && qty > item.product.available;

  return (
    <div className={`rounded-xl border p-3 ${item.result ? (item.result.ok ? (item.result.pending ? 'border-amber-200 bg-amber-50/50' : 'border-emerald-200 bg-emerald-50/50') : 'border-rose-200 bg-rose-50/50') : 'border-slate-200 bg-slate-50/50'}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-bold text-slate-500 ring-1 ring-slate-200">{index}</span>
        <div className="relative min-w-[14rem] flex-1">
          {item.product ? (
            <div className="rounded-xl bg-white px-3.5 py-2 ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-900">{item.product.label}</span>
                {!disabled && <button type="button" className="shrink-0 text-xs text-brand-700 underline" onClick={() => onChange({ product: null, result: undefined })}>trocar</button>}
              </div>
              <div className={`text-xs ${item.product.available > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                Disponível para venda: <b>{num(item.product.available)}{item.product.unit ? ` ${item.product.unit}` : ''}</b>{!item.product.confirmed && <span className="text-amber-700"> · não confirmado</span>}
              </div>
            </div>
          ) : (
            <input className="input" placeholder="Produto: SKU ou nome" value={q} onChange={(e) => setQ(e.target.value)} disabled={disabled} aria-label={`Produto do item ${index}`} />
          )}
          {results.length > 0 && (
            <div className="card absolute z-20 mt-1 w-full divide-y divide-slate-100 overflow-hidden shadow-[var(--shadow-lift)]">
              {results.map((p) => (
                <button type="button" key={p.id} className="block w-full px-4 py-2 text-left text-sm hover:bg-brand-50" onClick={() => void pick(p)}>
                  <span className="font-semibold text-brand-600">{p.sku ?? 'sem SKU'}</span> · {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="w-28">
          <input className="input" inputMode="decimal" placeholder="Qtd" value={item.quantity} onChange={(e) => onChange({ quantity: e.target.value })} disabled={disabled} aria-label={`Quantidade do item ${index}`} />
        </div>
        {onRemove && <button type="button" className="mt-1.5 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={onRemove} aria-label={`Remover item ${index}`}><Trash2 size={16} /></button>}
      </div>
      {over && !item.result && <p className="mt-2 pl-9 text-xs text-amber-700">A quantidade é maior que o disponível; a reserva pode ser recusada.</p>}
      {item.result && (
        <p className={`mt-2 flex items-center gap-1.5 pl-9 text-xs font-medium ${item.result.ok ? (item.result.pending ? 'text-amber-800' : 'text-emerald-700') : 'text-rose-700'}`}>
          {item.result.ok ? (item.result.pending ? <Clock3 size={14} /> : <CheckCircle2 size={14} />) : <XCircle size={14} />} {item.result.text}
        </p>
      )}
    </div>
  );
}
