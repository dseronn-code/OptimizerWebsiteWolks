import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorMsg, PageHeader, Table } from '../components/ui';
import { CATEGORY_LABEL, dateTime } from '../format';

type Tab = 'bling' | 'rules' | 'users' | 'settings' | 'sync' | 'audit';

export default function Admin() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs: [Tab, string][] = [
    ...(isAdmin ? ([['bling', 'Integração Bling']] as [Tab, string][]) : []),
    ['rules', 'Regras de situação'],
    ...(isAdmin ? ([['users', 'Usuários']] as [Tab, string][]) : []),
    ['settings', 'Parâmetros'],
    ['sync', 'Sincronização'],
    ...(isAdmin ? ([['audit', 'Auditoria']] as [Tab, string][]) : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-6">
      <PageHeader title={isAdmin ? 'Administração' : 'Configuração'} />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'bling' && <BlingTab />}
      {tab === 'rules' && <RulesTab editable={isAdmin} />}
      {tab === 'users' && <UsersTab />}
      {tab === 'settings' && <SettingsTab editable={isAdmin} />}
      {tab === 'sync' && <SyncTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

function BlingTab() {
  const [params] = useSearchParams();
  const [info, setInfo] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    api.get('/api/admin/bling').then(setInfo).catch((e) => setError(e.message));
    api.get<{ settings: any }>('/api/admin/settings').then((r) => setSettings(r.settings)).catch(() => undefined);
  };
  useEffect(load, []);
  const connect = async () => {
    try {
      const r = await api.post<{ url: string }>('/api/admin/bling/connect');
      window.location.href = r.url;
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const setMode = async (appMode: 'demo' | 'live') => {
    if (appMode === 'live' && !confirm('Passar para o modo Bling real? Os dados de demonstração continuarão no banco até serem apagados, mas as sincronizações passarão a usar a API do Bling.')) return;
    await api.put('/api/admin/settings', { appMode }).catch((e) => setError(e.message));
    window.location.reload();
  };
  const c = info?.connection;
  return (
    <div className="space-y-4">
      {params.get('bling') === 'conectado' && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Bling conectado. A sincronização completa foi agendada.</p>}
      {params.get('bling') === 'erro' && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Não foi possível concluir a conexão com o Bling.</p>}
      <ErrorMsg error={error} />
      <div className="card space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold">Modo de operação: {settings?.appMode === 'live' ? 'Bling (produção)' : 'Demonstração (dados fictícios)'}</div>
            <div className="text-slate-500">No modo demonstração, a sincronização usa um simulador da API com dados fictícios.</div>
          </div>
          {settings && (settings.appMode === 'demo'
            ? <button className="btn-primary" onClick={() => setMode('live')}>Usar Bling real</button>
            : <button className="btn-secondary" onClick={() => setMode('demo')}>Voltar para demonstração</button>)}
        </div>
      </div>
      <div className="card space-y-3 p-4 text-sm">
        <div className="font-semibold">Conexão OAuth 2.0</div>
        {!c?.configured && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            Configure BLING_CLIENT_ID, BLING_CLIENT_SECRET e BLING_REDIRECT_URI nas variáveis de ambiente do servidor (nunca no navegador) e reinicie a aplicação.
          </p>
        )}
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt className="label">Status</dt><dd>{c?.status ?? '—'}</dd></div>
          <div><dt className="label">Conectado em</dt><dd>{dateTime(c?.connected_at)}</dd></div>
          <div><dt className="label">Token expira</dt><dd>{dateTime(c?.access_expires_at)}</dd></div>
          <div><dt className="label">Última renovação</dt><dd>{dateTime(c?.last_refresh_at)}</dd></div>
          <div className="sm:col-span-2"><dt className="label">URL de redirecionamento (cadastrar no app do Bling)</dt><dd className="break-all font-mono text-xs">{info?.redirectUri ?? '—'}</dd></div>
          <div className="sm:col-span-2"><dt className="label">URL de webhook (cadastrar no app do Bling)</dt><dd className="break-all font-mono text-xs">{info?.webhookUrl}</dd></div>
          {c?.last_error && <div className="sm:col-span-2 text-rose-700">Último erro: {c.last_error}</div>}
        </dl>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!c?.configured} onClick={connect}>{c?.status === 'connected' ? 'Reconectar' : 'Conectar ao Bling'}</button>
          {c?.status === 'connected' && <button className="btn-secondary" onClick={() => api.post('/api/admin/bling/disconnect').then(load)}>Desconectar</button>}
        </div>
        <p className="text-xs text-slate-500">Fase 1: o sistema apenas LÊ dados do Bling. Nenhum pedido, estoque ou movimentação é alterado.</p>
      </div>
    </div>
  );
}

const CATEGORIES = ['COMMITTED', 'PRE_ORDER_RESERVED', 'OPPORTUNITY', 'CANCELLED', 'FULFILLED', 'IGNORED'];
const STOCK = { NOT_POSTED: 'Ainda não baixado', POSTED: 'Já baixado', UNKNOWN: 'Desconhecido' } as Record<string, string>;
const VIRTUAL = { REFLECTED: 'Já descontado', NOT_REFLECTED: 'Não descontado', UNKNOWN: 'Desconhecido' } as Record<string, string>;

function RulesTab({ editable }: { editable: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<{ situations: any[] }>('/api/admin/situations').then((r) => setRows(r.situations)).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const save = async (r: any, patch: any) => {
    const next = { ...r, ...patch };
    try {
      await api.put(`/api/admin/situations/${r.id}/rule`, {
        category: next.category || null,
        stockEffect: next.stock_effect ?? 'UNKNOWN',
        virtualEffect: next.virtual_effect ?? 'UNKNOWN',
        label: next.label ?? undefined,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Defina o que cada situação de pedido do Bling significa comercialmente e se, nessa situação, o estoque já foi baixado. Situações sem regra são tratadas
        como compromisso por precaução e deixam a disponibilidade "não confirmada". Situações personalizadas herdam a regra da situação de origem quando não têm regra própria.
      </p>
      <ErrorMsg error={error} />
      <div className="card overflow-hidden">
        <Table columns={['Situação', 'Pedidos', 'Significado comercial', 'Estoque físico', 'Saldo virtual']}>
          {rows.map((r) => (
            <tr key={r.id} className={!r.category ? 'bg-amber-50/50' : ''}>
              <td className="td">{r.name}<div className="text-xs text-slate-400">id {r.id}{r.inherited_name ? ` · herda de ${r.inherited_name}` : ''}</div></td>
              <td className="td tabular-nums">{r.orders}</td>
              <td className="td">
                <select className="input" disabled={!editable} value={r.category ?? ''} onChange={(e) => save(r, { category: e.target.value })}>
                  <option value="">{r.inherited_name ? '(herdar)' : '— sem regra —'}</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </select>
              </td>
              <td className="td">
                <select className="input" disabled={!editable || !r.category} value={r.stock_effect ?? 'UNKNOWN'} onChange={(e) => save(r, { stock_effect: e.target.value })}>
                  {Object.entries(STOCK).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td className="td">
                <select className="input" disabled={!editable || !r.category} value={r.virtual_effect ?? 'UNKNOWN'} onChange={(e) => save(r, { virtual_effect: e.target.value })}>
                  {Object.entries(VIRTUAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'vendedor', blingSellerId: '' });
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<{ users: any[] }>('/api/admin/users').then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/admin/users', { ...form, blingSellerId: form.blingSellerId ? Number(form.blingSellerId) : null });
      setForm({ username: '', name: '', password: '', role: 'vendedor', blingSellerId: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const update = async (id: string, patch: any) => {
    setError(null);
    await api.put(`/api/admin/users/${id}`, patch).catch((e) => setError(e.message));
    await load();
  };
  return (
    <div className="space-y-4">
      <form onSubmit={create} className="card grid gap-3 p-4 sm:grid-cols-6">
        <input className="input" placeholder="usuário" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <input className="input sm:col-span-2" placeholder="Nome completo" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" type="password" placeholder="Senha inicial" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="vendedor">Vendedor</option><option value="gestor">Gestor</option><option value="admin">Administrador</option>
        </select>
        <input className="input" placeholder="Id vendedor Bling" value={form.blingSellerId} onChange={(e) => setForm({ ...form, blingSellerId: e.target.value })} />
        <button className="btn-primary sm:col-span-6 sm:justify-self-end">Criar usuário</button>
      </form>
      <ErrorMsg error={error} />
      <div className="card overflow-hidden">
        <Table columns={['Usuário', 'Nome', 'Perfil', 'Vendedor Bling', 'Ativo', '']}>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="td font-mono text-xs">{u.username}</td>
              <td className="td">{u.name}{u.locked_until && new Date(u.locked_until) > new Date() && <span className="ml-2 text-xs text-rose-600">bloqueado</span>}</td>
              <td className="td">
                <select className="input" value={u.role} onChange={(e) => update(u.id, { role: e.target.value })}>
                  <option value="vendedor">Vendedor</option><option value="gestor">Gestor</option><option value="admin">Administrador</option>
                </select>
              </td>
              <td className="td"><input className="input w-28" defaultValue={u.bling_seller_id ?? ''} onBlur={(e) => update(u.id, { blingSellerId: e.target.value ? Number(e.target.value) : null })} /></td>
              <td className="td"><input type="checkbox" checked={u.active} onChange={(e) => update(u.id, { active: e.target.checked })} /></td>
              <td className="td">
                <button className="btn-secondary px-2 py-1 text-xs" onClick={() => { const p = prompt('Nova senha (mín. 10 caracteres, letras e números):'); if (p) void update(u.id, { password: p }); }}>Redefinir senha</button>
              </td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}

function SettingsTab({ editable }: { editable: boolean }) {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ settings: any }>('/api/admin/settings').then((r) => setS(r.settings)).catch((e) => setError(e.message));
  }, []);
  if (!s) return <ErrorMsg error={error} />;
  const set = (group: string, key: string, value: unknown) => setS({ ...s, [group]: { ...s[group], [key]: value } });
  const numField = (group: string, key: string, label: string) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="number" disabled={!editable} value={s[group][key]} onChange={(e) => set(group, key, Number(e.target.value))} />
    </div>
  );
  const save = async () => {
    setError(null);
    try {
      const { appMode: _m, ...rest } = s;
      await api.put('/api/admin/settings', rest);
      setMsg('Parâmetros salvos.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card space-y-5 p-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Base de cálculo</label>
          <select className="input" disabled={!editable} value={s.engine.baseMode} onChange={(e) => set('engine', 'baseMode', e.target.value)}>
            <option value="PHYSICAL">Estoque físico (recomendado)</option>
            <option value="VIRTUAL">Saldo virtual do Bling</option>
          </select>
        </div>
        {numField('engine', 'maxBalanceAgeMinutes', 'Saldo máx. sem atualização (min)')}
        {numField('engine', 'criticalRefreshMinutes', 'Atualizar saldo em consulta crítica após (min)')}
        {numField('engine', 'ordersMaxAgeMinutes', 'Pedidos máx. sem sincronizar (min)')}
        <div>
          <label className="label">Reserva vencida</label>
          <select className="input" disabled={!editable} value={s.engine.expiredReservationPolicy} onChange={(e) => set('engine', 'expiredReservationPolicy', e.target.value)}>
            <option value="KEEP_UNTIL_REVIEW">Mantém até revisão do gestor</option>
            <option value="AUTO_RELEASE">Libera automaticamente</option>
          </select>
        </div>
      </section>
      <section className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
        {numField('sync', 'incrementalMinutes', 'Sincronização incremental a cada (min)')}
        {numField('sync', 'reconcileMinutes', 'Reconciliação a cada (min)')}
        {numField('sync', 'initialLookbackDays', 'Carga inicial de pedidos (dias)')}
      </section>
      <section className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
        {numField('reservations', 'defaultValidityHours', 'Validade padrão da reserva (h)')}
        {numField('reservations', 'maxValidityDays', 'Validade máxima (dias)')}
        {numField('reservations', 'expiringSoonHours', 'Alertar vencimento com antecedência (h)')}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={s.reservations.autoApproveSellers} onChange={(e) => set('reservations', 'autoApproveSellers', e.target.checked)} /> Aprovar automaticamente reservas de vendedores quando houver saldo confirmado</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={s.privacy.sellersSeeAllCustomers} onChange={(e) => set('privacy', 'sellersSeeAllCustomers', e.target.checked)} /> Vendedores veem clientes de outros vendedores</label>
      </section>
      <section className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
        {numField('alerts', 'committedWithoutPostingDays', 'Alerta: pedido confirmado sem baixa após (dias)')}
        {numField('alerts', 'staleOpportunityDays', 'Alerta: pré-pedido parado após (dias)')}
      </section>
      <ErrorMsg error={error} />
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      {editable && <button className="btn-primary" onClick={save}>Salvar parâmetros</button>}
    </div>
  );
}

function SyncTab() {
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.get('/api/admin/sync/runs').then(setData).catch(() => undefined);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const run = async (kind: string) => {
    await api.post('/api/admin/sync', { kind });
    setMsg('Sincronização agendada. Acompanhe abaixo.');
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => run('incremental')}>Sincronizar agora</button>
        <button className="btn-secondary" onClick={() => run('full')}>Sincronização completa</button>
        <button className="btn-secondary" onClick={() => run('reconcile')}>Reconciliar pedidos</button>
        <button className="btn-secondary" onClick={() => run('alerts')}>Recalcular alertas</button>
      </div>
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Execuções</h2>
        <Table columns={['Início', 'Recurso', 'Status', 'Itens', 'Origem', 'Erro']}>
          {(data?.runs ?? []).map((r: any) => (
            <tr key={r.id}>
              <td className="td text-xs">{dateTime(r.started_at)}</td><td className="td">{r.kind}</td>
              <td className={`td text-xs font-semibold ${r.status === 'error' ? 'text-rose-600' : r.status === 'success' ? 'text-emerald-600' : 'text-slate-500'}`}>{r.status}</td>
              <td className="td tabular-nums">{r.items}</td><td className="td text-xs">{r.triggered_by}</td><td className="td text-xs text-rose-700">{r.error}</td>
            </tr>
          ))}
        </Table>
      </section>
      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Fila de processamento</h2>
        <Table columns={['Job', 'Status', 'Tentativas', 'Próxima execução', 'Erro']}>
          {(data?.jobs ?? []).map((j: any) => (
            <tr key={j.id}><td className="td">{j.type}</td><td className="td text-xs">{j.status}</td><td className="td text-xs">{j.attempts}/{j.max_attempts}</td><td className="td text-xs">{dateTime(j.run_at)}</td><td className="td text-xs text-rose-700">{j.last_error}</td></tr>
          ))}
        </Table>
      </section>
      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">Webhooks recebidos</h2>
        <Table columns={['Recebido', 'Evento', 'Recurso', 'Status', 'Observação']}>
          {(data?.webhooks ?? []).map((w: any) => (
            <tr key={w.event_id}><td className="td text-xs">{dateTime(w.received_at)}</td><td className="td text-xs">{w.resource}.{w.action}</td><td className="td text-xs">{w.resource_id}</td><td className="td text-xs">{w.status}</td><td className="td text-xs">{w.note}</td></tr>
          ))}
        </Table>
      </section>
    </div>
  );
}

function AuditTab() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api.get<{ audit: any[] }>('/api/admin/audit').then((r) => setRows(r.audit)).catch(() => undefined);
  }, []);
  return (
    <div className="card overflow-hidden">
      <Table columns={['Quando', 'Usuário', 'Ação', 'Entidade', 'Detalhes', 'IP']}>
        {rows.map((a) => (
          <tr key={a.id}>
            <td className="td text-xs">{dateTime(a.at)}</td><td className="td text-xs">{a.user_name ?? '—'}</td><td className="td text-xs font-mono">{a.action}</td>
            <td className="td text-xs">{a.entity ? `${a.entity} ${a.entity_id ?? ''}` : '—'}</td>
            <td className="td max-w-xs truncate text-xs" title={JSON.stringify(a.details)}>{a.details ? JSON.stringify(a.details) : ''}</td><td className="td text-xs">{a.ip}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
