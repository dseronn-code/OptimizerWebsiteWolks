import { AlertTriangle, CheckCircle2, Inbox, Info, XCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function StatusBadge({ status }: { status: 'CONFIRMED' | 'UNCONFIRMED' | string }) {
  return status === 'CONFIRMED' ? (
    <span className="chip bg-emerald-50 text-emerald-700 ring-emerald-200">
      <CheckCircle2 size={13} /> Confirmada
    </span>
  ) : (
    <span className="chip bg-amber-50 text-amber-800 ring-amber-200">
      <AlertTriangle size={13} /> Não confirmada
    </span>
  );
}

export function SeverityIcon({ severity }: { severity: string }) {
  const cls = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl';
  if (severity === 'critical') return <span className={`${cls} bg-rose-50 text-rose-600 ring-1 ring-rose-100`}><XCircle size={17} /></span>;
  if (severity === 'warning') return <span className={`${cls} bg-amber-50 text-amber-600 ring-1 ring-amber-100`}><AlertTriangle size={17} /></span>;
  return <span className={`${cls} bg-sky-50 text-sky-600 ring-1 ring-sky-100`}><Info size={17} /></span>;
}

type Tone = 'default' | 'good' | 'warn' | 'bad' | 'muted' | 'brand';

const TONES: Record<Tone, { box: string; icon: string; value: string; bar: string }> = {
  default: { box: 'bg-white', icon: 'bg-slate-100 text-slate-600', value: 'text-slate-900', bar: 'bg-slate-200' },
  muted: { box: 'bg-white', icon: 'bg-slate-100 text-slate-600', value: 'text-slate-900', bar: 'bg-slate-300' },
  brand: { box: 'bg-white', icon: 'bg-brand-50 text-brand-600', value: 'text-slate-900', bar: 'bg-brand-500' },
  good: { box: 'bg-gradient-to-br from-emerald-50 to-white', icon: 'bg-emerald-100 text-emerald-700', value: 'text-emerald-800', bar: 'bg-emerald-500' },
  warn: { box: 'bg-gradient-to-br from-amber-50 to-white', icon: 'bg-amber-100 text-amber-700', value: 'text-amber-900', bar: 'bg-amber-500' },
  bad: { box: 'bg-gradient-to-br from-rose-50 to-white', icon: 'bg-rose-100 text-rose-700', value: 'text-rose-800', bar: 'bg-rose-500' },
};

/** Indicador (KPI) com rótulo, valor grande e ícone opcional. */
export function Tile({ label, value, tone = 'default', hint, icon: Icon }: { label: string; value: ReactNode; tone?: Tone; hint?: string; icon?: LucideIcon }) {
  const t = TONES[tone];
  return (
    <div className={`card relative overflow-hidden p-4 ${t.box}`} title={hint}>
      <span className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${t.bar}`} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase leading-snug tracking-wider text-slate-500">{label}</div>
        {Icon && <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${t.icon}`}><Icon size={16} /></span>}
      </div>
      <div className={`mt-2 text-2xl font-bold tracking-tight tabular-nums ${t.value}`}>{value}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon: Icon }: { title: string; subtitle?: string; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="mb-6 flex animate-fade-up flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        {Icon && (
          <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[var(--shadow-glow)] sm:flex">
            <Icon size={21} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 border-dashed px-6 py-12 text-center text-sm text-slate-500">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Inbox size={20} /></span>
      {children}
    </div>
  );
}

export function ErrorMsg({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="flex animate-fade-in items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
      <XCircle size={16} className="mt-0.5 shrink-0" /> {error}
    </p>
  );
}

export function Table({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200/80">
        <thead>
          <tr>{columns.map((c, i) => <th key={`${c}-${i}`} className="th">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">{children}</tbody>
      </table>
    </div>
  );
}

/** Cabeçalho padrão de um bloco (card) com título, descrição e ações. */
export function SectionHead({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
      <div>
        <h2 className="section-title">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
