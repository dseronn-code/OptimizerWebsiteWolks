import { ArrowRight, Clock, PackageCheck, PackageX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ago, dateTime, num } from '../format';
import type { Availability, SaleCheck } from '../types';
import { SeverityIcon, StatusBadge, Tile } from './ui';

export default function AvailabilityCard({ data, sale, compact = false }: { data: Availability; sale?: SaleCheck | null; compact?: boolean }) {
  const d = data.deductions;
  const available = data.kit ? data.kit.availableForSale : data.availableForSale;
  const tone = data.status !== 'CONFIRMED' ? 'warn' : available > 0 ? 'good' : 'bad';
  const blocking = data.issues.filter((i) => i.blocksConfirmation);
  const others = data.issues.filter((i) => !i.blocksConfirmation);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-indigo-600">{data.product.sku ?? 'sem SKU'}</div>
          <div className="truncate font-medium text-slate-900">{data.product.name}</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <Clock size={12} /> Dados de {dateTime(data.dataAsOf)} ({ago(data.dataAsOf)}){data.refreshed && ' · saldo atualizado agora'}
          </div>
        </div>
        <StatusBadge status={data.status} />
      </div>

      {sale && (
        <div className={`flex items-start gap-2 px-4 py-3 text-sm ${sale.possible === true ? 'bg-emerald-50 text-emerald-900' : sale.possible === false ? 'bg-rose-50 text-rose-900' : 'bg-amber-50 text-amber-900'}`}>
          {sale.possible === true ? <PackageCheck size={18} className="shrink-0" /> : <PackageX size={18} className="shrink-0" />}
          <span>{sale.message}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
        <Tile label="Físico registrado" value={num(data.physicalTotal)} tone="muted" />
        {!compact && <Tile label="Virtual (Bling)" value={num(data.virtualTotal)} tone="muted" />}
        <Tile label="Pedidos pagos/confirmados" value={num(d.committedOrders)} />
        {(!compact || d.preOrderReservations > 0) && <Tile label="Pré-pedidos com reserva" value={num(d.preOrderReservations)} />}
        {(!compact || d.localReservations > 0) && <Tile label="Reservas complementares" value={num(d.localReservations)} />}
        {(!compact || d.blocked > 0) && <Tile label="Bloqueios" value={num(d.blocked)} />}
        {d.uncertain > 0 && <Tile label="Incertos (precaução)" value={num(d.uncertain)} tone="warn" />}
        <Tile label={data.kit ? 'Kits disponíveis' : 'Disponível p/ venda'} value={num(available)} tone={tone} />
      </div>

      {(blocking.length > 0 || others.length > 0 || data.refreshError) && (
        <ul className="space-y-1.5 border-t border-slate-100 px-4 py-3 text-sm">
          {data.refreshError && <li className="flex gap-2 text-rose-700"><SeverityIcon severity="critical" />{data.refreshError}</li>}
          {[...blocking, ...others].slice(0, compact ? 4 : 20).map((i, k) => (
            <li key={k} className="flex gap-2"><SeverityIcon severity={i.severity} /><span>{i.message}</span></li>
          ))}
        </ul>
      )}

      {data.incoming.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
          Entradas previstas (não contam no disponível): {data.incoming.map((e) => `${num(e.quantity)} em ${e.expectedDate ?? '—'}`).join(' · ')}
        </div>
      )}

      {compact && (
        <Link to={`/produtos/${data.product.id}`} className="flex items-center justify-end gap-1 border-t border-slate-100 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50">
          Ver cálculo detalhado <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}
