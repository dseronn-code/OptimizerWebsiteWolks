import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { ErrorMsg, PageHeader, Table, Tile } from '../components/ui';
import { CATEGORY_LABEL, dateTime, num, RESERVATION_STATUS } from '../format';

interface Row { id: number; sku: string | null; name: string; physical: number | null; available: number | null; availableForSale: number; status: string; issues: string[] }
interface Dash {
  products: { total: number; confirmed: number; unconfirmed: number };
  atRisk: Row[];
  divergent: Row[];
  orders: { category: string; situation: string | null; orders: number; units: number }[];
  reservations: { active: number; expiring: number; expired: number; pending: number };
  committedBySeller: { reservations: { seller: string; units: number; reservations: number }[]; orders: { seller: string; units: number; orders: number }[] };
  syncFailures: { kind: string; started_at: string; error: string }[];
  alerts: { severity: string; n: number }[];
  recentReservationChanges: { at: string; action: string; from_status: string | null; to_status: string | null; user_name: string | null; sku: string; quantity: number; customer_name: string }[];
}

export default function Dashboard() {
  const [deposits, setDeposits] = useState<{ id: number; name: string; ignore_balance: boolean }[]>([]);
  const [depositId, setDepositId] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<{ deposits: typeof deposits }>('/api/deposits').then((r) => setDeposits(r.deposits)).catch(() => undefined);
  }, []);
  const load = () => {
    setLoading(true);
    api.get<Dash>(`/api/dashboard${qs({ depositId, q })}`).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositId, q]);

  const alertCount = (s: string) => data?.alerts.find((a) => a.severity === s)?.n ?? 0;
  const byCategory = (c: string) => (data?.orders ?? []).filter((o) => o.category === c).reduce((s, o) => ({ orders: s.orders + o.orders, units: s.units + Number(o.units) }), { orders: 0, units: 0 });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-6">
      <PageHeader
        title="Painel de gestão"
        subtitle="Visão consolidada de disponibilidade, compromissos e riscos"
        actions={<button className="btn-secondary" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar</button>}
      />
      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <label className="label">Depósito</label>
          <select className="input" value={depositId} onChange={(e) => setDepositId(e.target.value)}>
            <option value="">Todos</option>
            {deposits.filter((d) => !d.ignore_balance).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2"><label className="label">Produto</label><input className="input" placeholder="Nome ou SKU" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <ErrorMsg error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Disponibilidade confirmada" value={`${data.products.confirmed} / ${data.products.total}`} tone="good" />
            <Tile label="Não confirmada" value={data.products.unconfirmed} tone={data.products.unconfirmed ? 'warn' : 'default'} />
            <Tile label="Com divergência" value={data.divergent.length} tone={data.divergent.length ? 'bad' : 'default'} />
            <Tile label="Risco de venda acima do saldo" value={data.atRisk.length} tone={data.atRisk.length ? 'bad' : 'default'} />
            <Tile label="Pedidos pagos/confirmados" value={`${byCategory('COMMITTED').orders} (${num(byCategory('COMMITTED').units)} un)`} />
            <Tile label="Pré-pedidos com reserva" value={`${byCategory('PRE_ORDER_RESERVED').orders} (${num(byCategory('PRE_ORDER_RESERVED').units)} un)`} />
            <Tile label="Reservas ativas / vencendo" value={`${data.reservations.active} / ${data.reservations.expiring}`} tone={data.reservations.expiring ? 'warn' : 'default'} />
            <Tile label="Reservas vencidas / pendentes" value={`${data.reservations.expired} / ${data.reservations.pending}`} tone={data.reservations.expired ? 'warn' : 'default'} />
            <Tile label="Alertas críticos" value={alertCount('critical')} tone={alertCount('critical') ? 'bad' : 'default'} />
            <Tile label="Alertas de atenção" value={alertCount('warning')} tone={alertCount('warning') ? 'warn' : 'default'} />
            <Tile label="Falhas de sincronização (7d)" value={data.syncFailures.length} tone={data.syncFailures.length ? 'bad' : 'default'} />
          </div>

          <ProductTable title="Produtos com divergências" rows={data.divergent} />
          <ProductTable title="Produtos com risco de venda acima do saldo" rows={data.atRisk} />

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card overflow-hidden">
              <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Pedidos em aberto por situação</h2>
              <Table columns={['Situação', 'Categoria', 'Pedidos', 'Unidades']}>
                {data.orders.map((o, i) => (
                  <tr key={i}><td className="td">{o.situation ?? '—'}</td><td className="td text-xs">{CATEGORY_LABEL[o.category]}</td><td className="td tabular-nums">{o.orders}</td><td className="td tabular-nums">{num(Number(o.units))}</td></tr>
                ))}
              </Table>
            </section>
            <section className="card overflow-hidden">
              <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Quantidade comprometida por vendedor</h2>
              <Table columns={['Vendedor', 'Pedidos (un)', 'Reservas (un)']}>
                {[...new Set([...data.committedBySeller.orders.map((o) => o.seller), ...data.committedBySeller.reservations.map((r) => r.seller)])].map((s) => (
                  <tr key={s}>
                    <td className="td">{s}</td>
                    <td className="td tabular-nums">{num(Number(data.committedBySeller.orders.find((o) => o.seller === s)?.units ?? 0))}</td>
                    <td className="td tabular-nums">{num(Number(data.committedBySeller.reservations.find((r) => r.seller === s)?.units ?? 0))}</td>
                  </tr>
                ))}
              </Table>
            </section>
          </div>

          <section className="card overflow-hidden">
            <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Histórico recente de reservas</h2>
            <Table columns={['Quando', 'Produto', 'Cliente', 'Qtd', 'Ação', 'Por']}>
              {data.recentReservationChanges.map((h, i) => (
                <tr key={i}>
                  <td className="td text-xs">{dateTime(h.at)}</td><td className="td">{h.sku}</td><td className="td">{h.customer_name}</td><td className="td tabular-nums">{num(h.quantity)}</td>
                  <td className="td text-xs">{h.action}{h.to_status ? ` → ${RESERVATION_STATUS[h.to_status] ?? h.to_status}` : ''}</td><td className="td text-xs">{h.user_name ?? 'sistema'}</td>
                </tr>
              ))}
            </Table>
          </section>

          {data.syncFailures.length > 0 && (
            <section className="card overflow-hidden">
              <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Falhas de sincronização</h2>
              <Table columns={['Quando', 'Recurso', 'Erro']}>
                {data.syncFailures.map((f, i) => <tr key={i}><td className="td text-xs">{dateTime(f.started_at)}</td><td className="td">{f.kind}</td><td className="td text-xs text-rose-700">{f.error}</td></tr>)}
              </Table>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ProductTable({ title, rows }: { title: string; rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">{title}</h2>
      <Table columns={['Produto', 'Físico', 'Saldo calculado', 'Disponível', 'Ocorrências']}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="td"><Link className="text-brand-600 hover:underline" to={`/produtos/${r.id}`}>{r.sku}</Link> <span className="text-slate-500">{r.name}</span></td>
            <td className="td tabular-nums">{num(r.physical)}</td>
            <td className={`td tabular-nums ${r.available !== null && r.available < 0 ? 'font-semibold text-rose-600' : ''}`}>{num(r.available)}</td>
            <td className="td tabular-nums">{num(r.availableForSale)}</td>
            <td className="td text-xs">{r.issues.join(', ')}</td>
          </tr>
        ))}
      </Table>
    </section>
  );
}
