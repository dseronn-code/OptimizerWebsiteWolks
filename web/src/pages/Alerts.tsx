import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorMsg, PageHeader, SeverityIcon } from '../components/ui';
import { ago } from '../format';

interface Alert {
  id: string;
  type: string;
  severity: string;
  message: string;
  product_id: number | null;
  sku: string | null;
  status: string;
  updated_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  COMMITTED_WITHOUT_POSTING: 'Pedido sem baixa',
  STALE_OPPORTUNITY: 'Pré-pedido parado',
  RESERVATION_EXPIRING: 'Reserva vencendo',
  RESERVATION_EXPIRED: 'Reserva vencida',
  NEGATIVE_BALANCE: 'Saldo negativo',
  OVERCOMMITTED: 'Risco de venda acima do saldo',
  POSSIBLE_DUPLICATE: 'Possível desconto duplicado',
  CANCELLED_WITH_ACTIVE_RESERVATION: 'Cancelado com reserva ativa',
  CANCELLED_AFTER_POSTING: 'Cancelado após baixa',
  UNMAPPED_SITUATION: 'Situação sem regra',
  INCOMING_PENDING: 'Entrada aguardando confirmação',
  SYNC_FAILED: 'Falha de sincronização',
  SYNC_STALE: 'Sincronização interrompida',
  PARTIAL_DELIVERY_NOT_POSTED: 'Entrega sem baixa',
  INSUFFICIENT_FOR_SALE: 'Estoque insuficiente para venda',
  SIGNUP_PENDING: 'Cadastro aguardando aprovação',
};

export default function Alerts() {
  const { user } = useAuth();
  const [status, setStatus] = useState('active');
  const [type, setType] = useState('');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<{ alerts: Alert[] }>(`/api/alerts${qs({ status, type })}`).then((r) => setAlerts(r.alerts)).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, type]);

  const act = async (id: string, action: 'ack' | 'resolve') => {
    await api.post(`/api/alerts/${id}/${action}`).catch((e) => setError(e.message));
    await load();
  };

  return (
    <div className="mx-auto max-w-5xl p-3 sm:p-6">
      <PageHeader title="Alertas" subtitle="Gerados automaticamente a partir do cálculo de disponibilidade e da sincronização" />
      <div className="card mb-4 flex flex-wrap gap-3 p-4">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Abertos</option>
          <option value="acknowledged">Reconhecidos</option>
          <option value="resolved">Resolvidos</option>
        </select>
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <ErrorMsg error={error} />
      {alerts.length === 0 ? <Empty>Nenhum alerta.</Empty> : (
        <ul className="card divide-y divide-slate-100">
          {alerts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-3 p-4">
              <SeverityIcon severity={a.severity} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{TYPE_LABEL[a.type] ?? a.type} · {ago(a.updated_at)}</div>
                <div className="text-sm">{a.message}</div>
                {a.product_id && <Link to={`/produtos/${a.product_id}`} className="text-xs text-brand-600 hover:underline">Abrir produto {a.sku}</Link>}
              </div>
              {user?.role !== 'vendedor' && a.status !== 'resolved' && (
                <div className="flex gap-1">
                  {a.status === 'open' && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => act(a.id, 'ack')}>Reconhecer</button>}
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => act(a.id, 'resolve')}>Resolver</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
