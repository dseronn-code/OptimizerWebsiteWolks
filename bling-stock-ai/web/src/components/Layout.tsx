import { AlertTriangle, BarChart3, Bell, Bookmark, ClipboardList, History, LogOut, MessageSquare, Menu, RefreshCw, Settings, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api';
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
    { to: '/pedidos', label: 'Compromissos', icon: ClipboardList },
    { to: '/reservas', label: 'Reservas', icon: Bookmark },
    { to: '/alertas', label: 'Alertas', icon: Bell },
    { to: '/historico', label: 'Histórico', icon: History },
    ...(user?.role !== 'vendedor' ? [{ to: '/gestao', label: 'Painel de gestão', icon: BarChart3 }] : []),
    ...(user?.role !== 'vendedor' ? [{ to: '/admin', label: user?.role === 'admin' ? 'Administração' : 'Configuração', icon: Settings }] : []),
  ];

  const nav = (
    <nav className="flex flex-col gap-1">
      {links.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`
          }
        >
          <Icon size={18} /> {label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full flex-col">
      {status?.appMode === 'demo' && (
        <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
          AMBIENTE DE DEMONSTRAÇÃO — todos os dados exibidos são fictícios e não vêm do Bling.
        </div>
      )}
      {failing && (
        <div className="flex items-center justify-center gap-2 bg-rose-600 px-4 py-1.5 text-center text-xs font-semibold text-white">
          <AlertTriangle size={14} /> Falha na sincronização com o Bling — disponibilidades ficarão como "não confirmadas".
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
          <Brand />
          <div className="mt-6 flex-1">{nav}</div>
          <Footer user={user} status={status} ordersAt={orders?.last_success_at ?? null} onLogout={logout} />
        </aside>
        {open && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-slate-900/40" />
            <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-white p-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <Brand />
                <button className="btn-secondary px-2" onClick={() => setOpen(false)} aria-label="Fechar menu"><X size={18} /></button>
              </div>
              <div className="mt-6 flex-1">{nav}</div>
              <Footer user={user} status={status} ordersAt={orders?.last_success_at ?? null} onLogout={logout} />
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 md:hidden">
            <button className="btn-secondary px-2" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu size={18} /></button>
            <Brand />
            <span className="text-xs text-slate-500">{ago(orders?.last_success_at)}</span>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <img src="/favicon.svg" alt="" className="h-7 w-7" />
      <span className="font-semibold text-slate-900">Bling Stock AI</span>
    </div>
  );
}

function Footer({ user, status, ordersAt, onLogout }: { user: ReturnType<typeof useAuth>['user']; status: Status | null; ordersAt: string | null; onLogout: () => void }) {
  return (
    <div className="space-y-3 border-t border-slate-200 pt-3 text-xs text-slate-500">
      <div className="flex items-center gap-2">
        <RefreshCw size={14} /> Pedidos sincronizados {ago(ordersAt)}
      </div>
      <div>IA: {status?.aiEngine === 'llm' ? 'modelo de linguagem' : 'interpretador local'}</div>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-slate-700">{user?.name}</div>
          <div>{user ? ROLE_LABEL[user.role] : ''}</div>
        </div>
        <button className="btn-secondary px-2" onClick={onLogout} title="Sair" aria-label="Sair"><LogOut size={16} /></button>
      </div>
    </div>
  );
}
