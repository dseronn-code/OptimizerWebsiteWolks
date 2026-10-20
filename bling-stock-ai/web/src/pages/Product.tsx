import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import AvailabilityCard from '../components/AvailabilityCard';
import { ErrorMsg, Table } from '../components/ui';
import { date, dateTime, num, TREATMENT_LABEL } from '../format';
import type { Availability, SaleCheck } from '../types';

export default function Product() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<Availability | null>(null);
  const [sale, setSale] = useState<SaleCheck | null>(null);
  const [qty, setQty] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showReserve, setShowReserve] = useState(false);

  const load = useCallback(
    async (opts: { refresh?: boolean; qty?: number } = {}) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.get<{ availability: Availability; sale: SaleCheck | null }>(
          `/api/products/${id}/availability${qs({ refresh: opts.refresh ? '1' : undefined, qty: opts.qty })}`,
        );
        setData(r.availability);
        setSale(r.sale);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <div className="p-6"><ErrorMsg error={error} /></div>;
  if (!data) return <div className="p-6 text-slate-500">Carregando…</div>;

  const deposits = Object.fromEntries(data.byDeposit.map((d) => [d.depositId, d.depositName]));

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600"><ArrowLeft size={16} /> Assistente</Link>
        <button className="btn-secondary" onClick={() => load({ refresh: true })} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar do Bling
        </button>
      </div>

      <form
        className="card flex flex-wrap items-end gap-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(qty.replace(',', '.'));
          if (n > 0) void load({ qty: n });
        }}
      >
        <div className="w-40">
          <label className="label" htmlFor="qty">Quantidade a vender</label>
          <input id="qty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Ex.: 35" />
        </div>
        <button className="btn-primary" disabled={loading}>Verificar venda</button>
        <button type="button" className="btn-secondary" onClick={() => setShowReserve((v) => !v)}>
          {user?.role === 'vendedor' ? 'Solicitar reserva' : 'Criar reserva'}
        </button>
      </form>

      {showReserve && <ReserveForm productId={data.product.id} deposits={data.byDeposit.filter((d) => !d.ignored)} onDone={() => { setShowReserve(false); void load(); }} />}
      <ErrorMsg error={error} />

      <AvailabilityCard data={data} sale={sale} />

      {data.kit && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Componentes do kit</h2>
          <Table columns={['Componente', 'Qtd por kit', 'Disponível', 'Status']}>
            {data.kit.components.map((c) => (
              <tr key={c.componentId}>
                <td className="td"><Link className="text-brand-600 hover:underline" to={`/produtos/${c.componentId}`}>{c.sku} · {c.name}</Link></td>
                <td className="td tabular-nums">{num(c.quantityPerKit)}</td>
                <td className="td tabular-nums">{num(c.availableForSale)}</td>
                <td className="td">{c.status === 'CONFIRMED' ? 'Confirmada' : 'Não confirmada'}</td>
              </tr>
            ))}
          </Table>
        </section>
      )}

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Visão por depósito</h2>
        <Table columns={['Depósito', 'Físico', 'Virtual', 'Descontos', 'Disponível', 'Atualizado']}>
          {data.byDeposit.map((d) => {
            const ded = d.deductions.committedOrders + d.deductions.preOrderReservations + d.deductions.localReservations + d.deductions.blocked + d.deductions.uncertain;
            return (
              <tr key={d.depositId} className={d.ignored ? 'text-slate-400' : ''}>
                <td className="td">{d.depositName}{d.ignored && ' (não compõe a disponibilidade)'}</td>
                <td className="td tabular-nums">{num(d.physical)}</td>
                <td className="td tabular-nums">{num(d.virtual)}</td>
                <td className="td tabular-nums">{num(ded)}</td>
                <td className="td font-semibold tabular-nums">{d.ignored ? '—' : num(d.availableForSale)}</td>
                <td className="td text-xs">{dateTime(d.fetchedAt)}</td>
              </tr>
            );
          })}
        </Table>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Como o disponível foi calculado</h2>
        <p className="px-4 pt-3 text-sm text-slate-600">
          Base: {data.baseMode === 'PHYSICAL' ? 'estoque físico' : 'saldo virtual'} = <b>{num(data.base)}</b> − compromissos subtraídos <b>{num(data.totalDeducted)}</b> ={' '}
          <b>{num(data.available)}</b>. Cada compromisso é contado uma única vez; os que já foram baixados no Bling não são subtraídos de novo.
        </p>
        {data.lines.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Nenhum pedido, reserva ou bloqueio para este produto.</p>
        ) : (
          <Table columns={['Origem', 'Cliente', 'Depósito', 'Qtd', 'Subtraído', 'Tratamento', 'Motivo']}>
            {data.lines.map((l) => (
              <tr key={l.refId} className={l.treatment === 'NOT_COUNTED' ? 'text-slate-400' : ''}>
                <td className="td">{l.label}{l.expiresAt && <div className="text-xs text-slate-400">vence {dateTime(l.expiresAt)}</div>}</td>
                <td className="td">{l.customerName ?? '—'}</td>
                <td className="td text-xs">{l.depositId ? deposits[l.depositId] : '—'}{l.depositAssumed && ' (presumido)'}</td>
                <td className="td tabular-nums">{num(l.quantity)}</td>
                <td className="td font-semibold tabular-nums">{l.subtracted ? num(l.subtracted) : '—'}</td>
                <td className="td text-xs">
                  <span className={`rounded px-1.5 py-0.5 ${l.treatment === 'SUBTRACTED' ? 'bg-brand-50 text-brand-700' : l.treatment === 'ALREADY_IN_BASE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {TREATMENT_LABEL[l.treatment]}
                  </span>
                  {l.uncertain && <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">incerto</span>}
                </td>
                <td className="td text-xs text-slate-600">{l.reason}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      {data.incoming.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Entradas previstas (não contam no disponível)</h2>
          <Table columns={['Pedido de compra', 'Fornecedor', 'Previsão', 'Quantidade']}>
            {data.incoming.map((e) => (
              <tr key={e.purchaseOrderId}>
                <td className="td">{e.purchaseOrderNumber ?? e.purchaseOrderId}</td>
                <td className="td">{e.supplierName ?? '—'}</td>
                <td className="td">{date(e.expectedDate)}</td>
                <td className="td tabular-nums">{num(e.quantity)}</td>
              </tr>
            ))}
          </Table>
        </section>
      )}
      <p className="text-center text-xs text-slate-400">Calculado em {dateTime(data.calculatedAt)} · fonte: {data.dataSource === 'demo' ? 'demonstração (fictício)' : 'Bling'}</p>
    </div>
  );
}

function ReserveForm({ productId, deposits, onDone }: { productId: number; deposits: Availability['byDeposit']; onDone: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ quantity: '', customerName: '', reason: '', negotiationRef: '', blingOrderId: '', depositId: '', validityHours: '48' });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ reservation: { status: string }; note: string | null }>('/api/reservations', {
        productId,
        quantity: Number(form.quantity.replace(',', '.')),
        customerName: form.customerName,
        reason: form.reason,
        negotiationRef: form.negotiationRef || null,
        blingOrderId: form.blingOrderId ? Number(form.blingOrderId) : null,
        depositId: form.depositId ? Number(form.depositId) : null,
        validityHours: Number(form.validityHours),
      });
      setNote(r.reservation.status === 'ACTIVE' ? 'Reserva ativa.' : r.note ?? 'Reserva enviada para aprovação do gestor.');
      setTimeout(onDone, 1200);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card grid gap-3 p-4 sm:grid-cols-3">
      <div><label className="label">Quantidade</label><input className="input" required inputMode="decimal" value={form.quantity} onChange={set('quantity')} /></div>
      <div><label className="label">Cliente / negociação</label><input className="input" required value={form.customerName} onChange={set('customerName')} /></div>
      <div>
        <label className="label">Depósito</label>
        <select className="input" value={form.depositId} onChange={set('depositId')}>
          <option value="">Qualquer (total)</option>
          {deposits.map((d) => <option key={d.depositId} value={d.depositId}>{d.depositName}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2"><label className="label">Motivo / justificativa</label><input className="input" required value={form.reason} onChange={set('reason')} /></div>
      <div><label className="label">Validade (horas)</label><input className="input" inputMode="numeric" value={form.validityHours} onChange={set('validityHours')} /></div>
      <div><label className="label">Referência da negociação</label><input className="input" value={form.negotiationRef} onChange={set('negotiationRef')} /></div>
      <div><label className="label">Pedido Bling vinculado (id)</label><input className="input" inputMode="numeric" value={form.blingOrderId} onChange={set('blingOrderId')} /></div>
      <div className="flex items-end"><button className="btn-primary w-full" disabled={busy}>{user?.role === 'vendedor' ? 'Solicitar' : 'Reservar'}</button></div>
      <div className="sm:col-span-3"><ErrorMsg error={error} />{note && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{note}</p>}</div>
    </form>
  );
}
