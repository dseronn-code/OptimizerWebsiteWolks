import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorMsg, PageHeader, Table } from '../components/ui';
import { CATEGORY_LABEL, date, num } from '../format';

interface Order {
  id: number;
  number: number | null;
  order_date: string | null;
  expected_date: string | null;
  customer_name: string | null;
  situation: string | null;
  category: string;
  stock_effect: string;
  items: { itemId: number; productId: number | null; sku: string | null; name: string | null; quantity: number }[];
}

const EFFECT = { NOT_POSTED: 'Não baixado', POSTED: 'Baixado', UNKNOWN: 'Desconhecido' } as Record<string, string>;

export default function Orders() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ category: '', customer: '', from: '', to: '' });
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fulfill, setFulfill] = useState<Order | null>(null);

  const load = () =>
    api.get<{ orders: Order[] }>(`/api/orders${qs(filters)}`).then((r) => setOrders(r.orders)).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const manager = user?.role !== 'vendedor';
  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-6">
      <PageHeader title="Compromissos comerciais" subtitle="Pedidos do Bling em aberto e como cada um afeta o estoque" />
      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-4">
        <div>
          <label className="label">Situação comercial</label>
          <select className="input" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
            <option value="">Todas em aberto</option>
            {['COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY', 'UNMAPPED'].map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div><label className="label">Cliente</label><input className="input" value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })} /></div>
        <div><label className="label">De</label><input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
        <div><label className="label">Até</label><input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
      </div>
      <ErrorMsg error={error} />
      {orders.length === 0 ? <Empty>Nenhum pedido encontrado.</Empty> : (
        <div className="card overflow-hidden">
          <Table columns={['Pedido', 'Data', 'Cliente', 'Situação', 'Estoque', 'Itens', ...(manager ? [''] : [])]}>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="td font-medium">{o.number ?? o.id}</td>
                <td className="td text-xs">{date(o.order_date)}{o.expected_date && <div className="text-slate-400">prev. {date(o.expected_date)}</div>}</td>
                <td className="td">{o.customer_name ?? '—'}</td>
                <td className="td text-xs">{o.situation ?? '—'}<div className={o.category === 'UNMAPPED' ? 'text-amber-600' : 'text-slate-400'}>{CATEGORY_LABEL[o.category]}</div></td>
                <td className="td text-xs">{EFFECT[o.stock_effect]}</td>
                <td className="td text-xs">
                  {o.items.map((i) => (
                    <div key={i.itemId}>{i.productId ? <Link className="text-brand-600 hover:underline" to={`/produtos/${i.productId}`}>{i.sku ?? i.name}</Link> : i.sku ?? i.name} × {num(i.quantity)}</div>
                  ))}
                </td>
                {manager && <td className="td"><button className="btn-secondary px-2 py-1 text-xs" onClick={() => setFulfill(o)}>Ajustar</button></td>}
              </tr>
            ))}
          </Table>
        </div>
      )}
      {fulfill && <AdjustOrder order={fulfill} onClose={() => { setFulfill(null); void load(); }} />}
    </div>
  );
}

function AdjustOrder({ order, onClose }: { order: Order; onClose: () => void }) {
  const [effect, setEffect] = useState(order.stock_effect);
  const [itemId, setItemId] = useState(order.items[0]?.itemId ?? 0);
  const [delivered, setDelivered] = useState('');
  const [released, setReleased] = useState('');
  const [posted, setPosted] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const saveEffect = async () => {
    try {
      await api.put(`/api/orders/${order.id}/override`, { stockEffect: effect === 'UNKNOWN' ? 'UNKNOWN' : effect, notes });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  const saveFulfillment = async () => {
    try {
      await api.post(`/api/order-items/${itemId}/fulfillments`, { quantityDelivered: Number(delivered || 0), quantityReleased: Number(released || 0), deliveredStockPosted: posted, notes });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3" onClick={onClose}>
      <div className="card w-full max-w-lg space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">Controles complementares — pedido {order.number ?? order.id}</h2>
        <p className="text-xs text-slate-500">Esses ajustes ficam apenas neste sistema (o Bling não é alterado) e são registrados na auditoria.</p>
        <div>
          <label className="label">A baixa de estoque deste pedido já foi feita no Bling?</label>
          <div className="flex gap-2">
            <select className="input" value={effect} onChange={(e) => setEffect(e.target.value)}>
              <option value="NOT_POSTED">Não baixado</option>
              <option value="POSTED">Já baixado (não subtrair de novo)</option>
              <option value="UNKNOWN">Desconhecido (subtrai por precaução)</option>
            </select>
            <button className="btn-primary" onClick={saveEffect}>Salvar</button>
          </div>
        </div>
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <label className="label">Entrega parcial / liberação de quantidade</label>
          <select className="input" value={itemId} onChange={(e) => setItemId(Number(e.target.value))}>
            {order.items.map((i) => <option key={i.itemId} value={i.itemId}>{i.sku ?? i.name} × {num(i.quantity)}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Qtd entregue" inputMode="decimal" value={delivered} onChange={(e) => setDelivered(e.target.value)} />
            <input className="input" placeholder="Qtd liberada" inputMode="decimal" value={released} onChange={(e) => setReleased(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={posted} onChange={(e) => setPosted(e.target.checked)} /> A entrega já teve baixa lançada no Bling</label>
          <input className="input" placeholder="Observação" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="btn-primary" onClick={saveFulfillment}>Registrar</button>
        </div>
        <ErrorMsg error={error} />
        <div className="text-right"><button className="btn-secondary" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
