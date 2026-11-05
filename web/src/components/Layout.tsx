import { BRAND } from '../brand';
import { AlertTriangle, BarChart3, Boxes, Bell, Bookmark, ClipboardList, History, LogOut, MessageSquare, Menu, RefreshCw, Settings, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api';
import { resetIntro } from './Intro';
import { useAuth } from '../auth';
import { ago } from '../format';

interface Status {
  appMode: 'demo' | 'live';
  aiEngine: 'llm' | 'local';
  sync: { resource: string; last_success_at: string | null; failing: boolean }[];
}

const ROLE_LABEL = { vendedor: 'Vendedor', gestor: 'Gestor', admin: 'Administrador' };

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = () => api.get<Status>('/api/status').then(setStatus).catch(() => undefined);
    void load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const orders = status?.sync.find((s) => s.resource === 'sales_orders');
  const failing = status?.sync.some((s) => s.failing && ['sales_orders', 'balances', 'products'].includes(s.resource));

  const links = [
    { to: '/', label: 'Assistente', icon: MessageSquare, end: true },
    { to: '/estoque', label: 'Estoque', icon: Boxes },
    { to: '/pedidos', label: 'Compromissos', icon: ClipboardList },
    { to: '/reservas', label: 'Reservas', icon: Bookmark },
    { to: '/alertas', label: 'Alertas', icon: Bell },
    { to: '/historico', label: 'Histórico', icon: History },
    ...(user?.role !== 'vendedor' ? [{ to: '/gestao', label: 'Painel de gestão', icon: BarChart3 }] : []),
    ...(user?.role !== 'vendedor' ? [{ to: '/admin', label: user?.role === 'admin' ? 'Administração' : 'Configuração', icon: Settings }] : []),
  ];

  const nav = (
    <nav className="flex flex-col gap-1">
      <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-300/70">Menu</div>
      {links.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded-xl px-2.5 py-1.5 text-sm font-medium transition-all duration-150 ${
              isActive
                ? 'bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]'
                : 'text-brand-100/75 hover:bg-white/[0.05] hover:text-white'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-gradient-to-b from-accent-500 to-brand-400" aria-hidden />}
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${isActive ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-[var(--shadow-glow)]' : 'text-brand-200/80 group-hover:text-white'}`}>
                <Icon size={17} />
              </span>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  const sidebar = (
    <div className="relative flex h-full flex-col overflow-hidden bg-brand-950 p-4 text-white">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-72 w-72 rounded-full bg-accent-500/10 blur-3xl" aria-hidden />
      <div className="relative px-2 pt-1"><Brand dark /></div>
      <div className="relative mt-8 flex-1 overflow-y-auto">{nav}</div>
      <div className="relative"><Footer user={user} status={status} ordersAt={orders?.last_success_at ?? null} onLogout={logout} /></div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {status?.appMode === 'demo' && (
        <div className="bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
          AMBIENTE DE DEMONSTRAÇÃO — todos os dados exibidos são fictícios e não vêm do Bling.
        </div>
      )}
      {failing && (
        <div className="flex items-center justify-center gap-2 bg-rose-600 px-4 py-1.5 text-center text-xs font-semibold text-white">
          <AlertTriangle size={14} /> Falha na sincronização com o Bling — disponibilidades ficarão como "não confirmadas".
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 md:block">{sidebar}</aside>
        {open && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-sm" />
            <aside className="absolute left-0 top-0 h-full w-72 animate-fade-in shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {sidebar}
              <button className="absolute right-3 top-4 rounded-lg p-2 text-brand-100 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Fechar menu"><X size={18} /></button>
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between bg-brand-950 px-3 py-2.5 shadow-lg md:hidden">
            <button className="rounded-xl p-2 text-white hover:bg-white/10" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu size={22} /></button>
            <Brand dark compact />
            <span className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] text-brand-100"><RefreshCw size={11} /> {ago(orders?.last_success_at)}</span>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto"><div className="animate-fade-in">{children}</div></main>
        </div>
      </div>
    </div>
  );
}

function Brand({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <div className={`flex flex-col leading-tight ${compact ? 'items-center' : ''}`}>
      <img src={dark ? BRAND.logoOnDark : BRAND.logo} alt={BRAND.company} className={`${compact ? 'h-6' : 'h-8'} w-auto ${compact ? '' : 'self-start'}`} />
      <span className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${dark ? 'text-brand-200' : 'text-brand-600'}`}>{BRAND.appName}</span>
    </div>
  );
}

function initials(name: string | undefined) {
  return (name ?? '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function Footer({ user, status, ordersAt, onLogout }: { user: ReturnType<typeof useAuth>['user']; status: Status | null; ordersAt: string | null; onLogout: () => void }) {
  const ai = status?.aiEngine === 'llm';
  return (
    <div className="space-y-3 pt-4 text-xs">
      <div className="space-y-2 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
        <div className="flex items-center gap-2 text-brand-100/80">
          <RefreshCw size={13} className="shrink-0" /> Pedidos sincronizados {ago(ordersAt)}
        </div>
        <div className="flex items-center gap-2 text-brand-100/80">
          <span className="relative flex h-2 w-2 shrink-0">
            {ai && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${ai ? 'bg-emerald-400' : 'bg-slate-400'}`} />
          </span>
          {ai ? 'IA ligada' : 'IA desligada (respostas do sistema)'}
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl p-1">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-xs font-bold text-white ring-1 ring-white/20">{initials(user?.name)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{user?.name}</div>
          <div className="text-brand-200/70">{user ? ROLE_LABEL[user.role] : ''}</div>
        </div>
        <button className="rounded-xl p-2 text-brand-100 transition hover:bg-white/10 hover:text-white" onClick={onLogout} title="Sair" aria-label="Sair"><LogOut size={17} /></button>
      </div>
      <button
        className="px-1 text-left text-[11px] text-brand-300/70 underline-offset-2 hover:text-rose-300 hover:underline"
        onClick={async () => {
          if (!confirm('Sair desta conta em TODOS os aparelhos (celulares e computadores)?')) return;
          resetIntro();
          await api.post('/api/auth/logout-all').catch(() => undefined);
          window.location.reload();
        }}
      >
        Sair de todos os aparelhos
      </button>
    </div>
  );
}
