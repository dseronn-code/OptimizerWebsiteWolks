import { ArrowRight, Clock, PackageCheck, PackageX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ago, date, dateTime, num } from '../format';
import type { Availability, SaleCheck } from '../types';
import { SeverityIcon, StatusBadge } from './ui';

const HERO = {
  good: 'bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-[0_10px_30px_-10px_rgb(5_150_105/0.6)]',
  warn: 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-[0_10px_30px_-10px_rgb(217_119_6/0.6)]',
  bad: 'bg-gradient-to-br from-slate-500 to-slate-700 shadow-[0_10px_30px_-10px_rgb(51_65_85/0.5)]',
} as const;

function minus(n: number) {
  return n ? `− ${num(n)}` : '0';
}

function Row({ label, value, strong, muted, warn, hide }: { label: string; value: string; strong?: boolean; muted?: boolean; warn?: boolean; hide?: boolean }) {
  if (hide) return null;
  return (
    <div className={`flex items-center justify-between gap-3 py-1 ${muted ? 'text-slate-400' : warn ? 'text-amber-700' : strong ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

export default function AvailabilityCard({ data, sale, compact = false }: { data: Availability; sale?: SaleCheck | null; compact?: boolean }) {
  const d = data.deductions;
  const available = data.kit ? data.kit.availableForSale : data.availableForSale;
  const tone: keyof typeof HERO = data.status !== 'CONFIRMED' ? 'warn' : available > 0 ? 'good' : 'bad';
  const blocking = data.issues.filter((i) => i.blocksConfirmation);
  const others = data.issues.filter((i) => !i.blocksConfirmation);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-brand-600">{data.product.sku ?? 'sem SKU'}</div>
          <div className="truncate text-base font-semibold text-slate-900">{data.product.name}</div>
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

      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,15rem)_1fr] sm:p-5">
        {/* número principal */}
        <div className={`relative flex flex-col justify-between overflow-hidden rounded-2xl p-5 text-white ${HERO[tone]}`}>
          <span className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <div className="relative text-[11px] font-semibold uppercase tracking-wider text-white/80">{data.kit ? 'Kits disponíveis' : 'Disponível para venda'}</div>
          <div className="relative mt-3 flex items-baseline gap-1.5">
            <span className="text-5xl font-bold tracking-tight tabular-nums">{num(available)}</span>
            {data.product.unit && <span className="text-sm font-medium text-white/80">{data.product.unit}</span>}
          </div>
          <div className="relative mt-3 text-xs text-white/85">
            {data.status === 'CONFIRMED' ? (available > 0 ? 'Pode vender até essa quantidade.' : 'Sem saldo livre para nova venda.') : 'Não confirmado: confira os avisos.'}
          </div>
        </div>

        {/* como chegou nesse número */}
        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 text-sm">
          <Row label="Estoque físico registrado" value={num(data.physicalTotal)} strong />
          {!compact && data.virtualTotal !== null && <Row label="Saldo virtual no Bling (referência)" value={num(data.virtualTotal)} muted />}
          <div className="my-2 border-t border-dashed border-slate-200" />
          <Row label="Pedidos pagos/confirmados não baixados" value={minus(d.committedOrders)} hide={compact && !d.committedOrders} />
          <Row label="Pré-pedidos com reserva" value={minus(d.preOrderReservations)} hide={!d.preOrderReservations && compact} />
          <Row label="Reservas complementares" value={minus(d.localReservations)} hide={!d.localReservations && compact} />
          <Row label="Bloqueios operacionais" value={minus(d.blocked)} hide={!d.blocked && compact} />
          {d.uncertain > 0 && <Row label="Incertos (descontados por precaução)" value={minus(d.uncertain)} warn />}
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
            <span>= {data.kit ? 'Kits disponíveis' : 'Disponível para venda'}</span>
            <span className={`tabular-nums ${available > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{num(available)}</span>
          </div>
        </div>
      </div>

      {(blocking.length > 0 || others.length > 0 || data.refreshError) && (
        <ul className="space-y-2 border-t border-slate-100 px-5 py-4 text-sm">
          {data.refreshError && <li className="flex gap-2 text-rose-700"><SeverityIcon severity="critical" />{data.refreshError}</li>}
          {[...blocking, ...others].slice(0, compact ? 4 : 20).map((i, k) => (
            <li key={k} className="flex items-center gap-3"><SeverityIcon severity={i.severity} /><span className="text-slate-700">{i.message}</span></li>
          ))}
        </ul>
      )}

      {data.incoming.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
          Entradas previstas (não contam no disponível): {data.incoming.map((e) => `${num(e.quantity)} para ${e.expectedDate ? date(e.expectedDate) : 'data não informada'}`).join(' · ')}
        </div>
      )}

      {compact && (
        <Link to={`/produtos/${data.product.id}`} className="flex items-center justify-end gap-1 border-t border-slate-100 px-4 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50">
          Ver cálculo detalhado <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}
