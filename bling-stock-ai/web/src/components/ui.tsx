import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function StatusBadge({ status }: { status: 'CONFIRMED' | 'UNCONFIRMED' | string }) {
  return status === 'CONFIRMED' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
      <CheckCircle2 size={13} /> Confirmada
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
      <AlertTriangle size={13} /> Não confirmada
    </span>
  );
}

export function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <XCircle size={16} className="shrink-0 text-rose-600" />;
  if (severity === 'warning') return <AlertTriangle size={16} className="shrink-0 text-amber-600" />;
  return <Info size={16} className="shrink-0 text-sky-600" />;
}

export function Tile({ label, value, tone = 'default', hint }: { label: string; value: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' | 'muted'; hint?: string }) {
  const tones = {
    default: 'bg-white',
    good: 'bg-emerald-50 ring-emerald-200',
    warn: 'bg-amber-50 ring-amber-200',
    bad: 'bg-rose-50 ring-rose-200',
    muted: 'bg-slate-50',
  };
  return (
    <div className={`rounded-lg p-3 ring-1 ring-slate-200 ${tones[tone]}`} title={hint}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function ErrorMsg({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
}

export function Table({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>{columns.map((c) => <th key={c} className="th">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">{children}</tbody>
      </table>
    </div>
  );
}
