import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorMsg, PageHeader, Table } from '../components/ui';
import { dateTime, num, RESERVATION_STATUS } from '../format';

interface Reservation {
  id: string;
  product_id: number;
  sku: string | null;
  product_name: string;
  deposit_name: string | null;
  quantity: number;
  customer_name: string;
  negotiation_ref: string | null;
  bling_order_id: number | null;
  seller_user_id: string;
  seller_name: string;
  status: string;
  reason: string;
  expires_at: string;
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-sky-50 text-sky-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  EXPIRED: 'bg-amber-50 text-amber-800',
  CONVERTED: 'bg-brand-50 text-brand-700',
};

export default function Reservations() {
  const { user } = useAuth();
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(user?.role === 'vendedor');
  const [customer, setCustomer] = useState('');
  const [rows, setRows] = useState<Reservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; items: any[] } | null>(null);

  const load = () =>
    api.get<{ reservations: Reservation[] }>(`/api/reservations${qs({ status, mine: mine ? '1' : undefined, customer })}`)
      .then((r) => setRows(r.reservations))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mine, customer]);

  const act = async (r: Reservation, action: string) => {
    setError(null);
    let body: Record<string, unknown> = {};
    if (action === 'renew') {
      const h = prompt('Renovar por quantas horas?', '48');
      if (!h) return;
      body = { hours: Number(h) };
    } else if (action === 'link') {
      const id = prompt('Id do pedido no Bling para vincular:');
      if (!id) return;
      body = { blingOrderId: Number(id) };
    } else if (['reject', 'cancel', 'release'].includes(action)) {
      const reason = prompt('Motivo (opcional):') ?? undefined;
      body = { reason };
    }
    try {
      await api.post(`/api/reservations/${r.id}/${action}`, body);
      await load();
    } catch (e) {
      const msg = (e as Error).message;
      if (action === 'approve' && msg.includes('não confirmada') && confirm(`${msg}\n\nAprovar mesmo assim?`)) {
        await api.post(`/api/reservations/${r.id}/approve`, { forceUnconfirmed: true }).catch((err) => setError(err.message));
        await load();
      } else setError(msg);
    }
  };

  const showHistory = async (id: string) => {
    const r = await api.get<{ history: any[] }>(`/api/reservations/${id}/history`);
    setHistory({ id, items: r.history });
  };

  const manager = user?.role !== 'vendedor';
  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-6">
      <PageHeader title="Reservas" subtitle="Reservas complementares ao Bling (não alteram o ERP). Para reservar, abra o produto e use “Solicitar reserva”." />
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">Situação</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(RESERVATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><label className="label">Cliente</label><input className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} /></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Somente as minhas</label>
      </div>
      <ErrorMsg error={error} />
      {rows.length === 0 ? <Empty>Nenhuma reserva.</Empty> : (
        <div className="card overflow-hidden">
          <Table columns={['Produto', 'Qtd', 'Cliente', 'Vendedor', 'Situação', 'Validade', 'Ações']}>
            {rows.map((r) => {
              const own = r.seller_user_id === user?.id;
              const expired = r.status === 'ACTIVE' && new Date(r.expires_at) < new Date();
              const st = expired ? 'EXPIRED' : r.status;
              return (
                <tr key={r.id}>
                  <td className="td"><Link className="text-brand-600 hover:underline" to={`/produtos/${r.product_id}`}>{r.sku ?? r.product_name}</Link><div className="text-xs text-slate-400">{r.deposit_name ?? 'qualquer depósito'}</div></td>
                  <td className="td tabular-nums">{num(r.quantity)}</td>
                  <td className="td">{r.customer_name}<div className="text-xs text-slate-400">{r.reason}{r.bling_order_id ? ` · pedido ${r.bling_order_id}` : ''}</div></td>
                  <td className="td text-sm">{r.seller_name}</td>
                  <td className="td"><span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[st] ?? 'bg-slate-100 text-slate-600'}`}>{RESERVATION_STATUS[st]}</span></td>
                  <td className="td text-xs">{dateTime(r.expires_at)}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {manager && r.status === 'PENDING' && <button className="btn-primary px-2 py-1 text-xs" onClick={() => act(r, 'approve')}>Aprovar</button>}
                      {manager && r.status === 'PENDING' && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => act(r, 'reject')}>Rejeitar</button>}
                      {(own || manager) && ['ACTIVE', 'EXPIRED'].includes(r.status) && (manager || r.status === 'ACTIVE') && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => act(r, 'renew')}>Renovar</button>}
                      {(own || manager) && ['PENDING', 'ACTIVE', 'EXPIRED'].includes(r.status) && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => act(r, 'link')}>Vincular pedido</button>}
                      {manager && ['ACTIVE', 'EXPIRED'].includes(r.status) && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => act(r, 'release')}>Liberar</button>}
                      {(own || manager) && ['PENDING', 'ACTIVE', 'EXPIRED'].includes(r.status) && <button className="btn-secondary px-2 py-1 text-xs text-rose-600" onClick={() => act(r, 'cancel')}>Cancelar</button>}
                      <button className="px-2 py-1 text-xs text-slate-500 underline" onClick={() => showHistory(r.id)}>Histórico</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}
      {history && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3" onClick={() => setHistory(null)}>
          <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 font-semibold">Histórico da reserva</h2>
            <ul className="space-y-2 text-sm">
              {history.items.map((h) => (
                <li key={h.id} className="border-l-2 border-brand-200 pl-3">
                  <div className="font-medium">{h.action} {h.from_status ? `${RESERVATION_STATUS[h.from_status] ?? h.from_status} → ` : ''}{RESERVATION_STATUS[h.to_status] ?? h.to_status ?? ''}</div>
                  <div className="text-xs text-slate-500">{dateTime(h.at)} · {h.user_name ?? 'sistema'}{h.details?.reason ? ` · ${h.details.reason}` : ''}</div>
                </li>
              ))}
            </ul>
            <div className="mt-4 text-right"><button className="btn-secondary" onClick={() => setHistory(null)}>Fechar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
