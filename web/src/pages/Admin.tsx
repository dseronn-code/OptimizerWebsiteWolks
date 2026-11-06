import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorMsg, PageHeader, Table } from '../components/ui';
import { auditDetails, auditEntity, AUDIT_ACTION, BLING_STATUS, CATEGORY_LABEL, dateTime, formatPhone, JOB_STATUS, JOB_TYPE, SYNC_RESOURCE, SYNC_STATUS, syncOrigin, WEBHOOK_STATUS } from '../format';

type Tab = 'bling' | 'whatsapp' | 'rules' | 'users' | 'settings' | 'sync' | 'audit';

export default function Admin() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs: [Tab, string][] = [
    ...(isAdmin ? ([['bling', 'Integração Bling'], ['whatsapp', 'WhatsApp']] as [Tab, string][]) : []),
    ['rules', 'Regras de situação'],
    ...(isAdmin ? ([['users', 'Usuários']] as [Tab, string][]) : []),
    ['settings', 'Parâmetros'],
    ['sync', 'Sincronização'],
    ...(isAdmin ? ([['audit', 'Auditoria']] as [Tab, string][]) : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <PageHeader icon={Settings} title={isAdmin ? 'Administração' : 'Configuração'} subtitle={isAdmin ? 'Integração com o Bling, regras, usuários, parâmetros e registros do sistema' : 'Regras de situação e parâmetros de cálculo'} />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/70 p-1 shadow-sm backdrop-blur">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${tab === k ? 'bg-brand-600 text-white shadow-[var(--shadow-glow)]' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'bling' && <BlingTab />}
      {tab === 'whatsapp' && <WhatsAppTab />}
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
        <div className="font-semibold">Conexão com o Bling</div>
        {!c?.configured && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            Configure BLING_CLIENT_ID, BLING_CLIENT_SECRET e BLING_REDIRECT_URI nas variáveis de ambiente do servidor (nunca no navegador) e reinicie a aplicação.
          </p>
        )}
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt className="label">Situação</dt><dd className={c?.status === 'connected' ? 'font-medium text-emerald-700' : ''}>{c?.status ? BLING_STATUS[c.status] ?? c.status : '—'}</dd></div>
          <div><dt className="label">Conectado em</dt><dd>{dateTime(c?.connected_at)}</dd></div>
          <div><dt className="label">Acesso válido até</dt><dd>{dateTime(c?.access_expires_at)}</dd></div>
          <div><dt className="label">Última renovação do acesso</dt><dd>{dateTime(c?.last_refresh_at)}</dd></div>
          <div className="sm:col-span-2"><dt className="label">URL de redirecionamento (cadastrar no app do Bling)</dt><dd className="break-all font-mono text-xs">{info?.redirectUri ?? '—'}</dd></div>
          <div className="sm:col-span-2"><dt className="label">URL de webhook (cadastrar no app do Bling)</dt><dd className="break-all font-mono text-xs">{info?.webhookUrl}</dd></div>
          {c?.last_error && <div className="sm:col-span-2 text-rose-700">Último erro: {c.last_error}</div>}
        </dl>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!c?.configured} onClick={connect}>{c?.status === 'connected' ? 'Reconectar' : 'Conectar ao Bling'}</button>
          {c?.status === 'connected' && <button className="btn-secondary" onClick={() => api.post('/api/admin/bling/disconnect').then(load)}>Desconectar</button>}
        </div>
        <p className="text-xs text-slate-500">Somente leitura: o sistema apenas consulta o Bling. Nenhum pedido, estoque ou movimentação é alterado.</p>
      </div>
    </div>
  );
}

function WhatsAppTab() {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get('/api/admin/whatsapp').then(setD).catch((e) => setError(e.message));
  }, []);
  if (!d) return <ErrorMsg error={error} />;
  const items: [string, boolean][] = [
    ['Token de acesso (WHATSAPP_TOKEN)', d.tokenSet],
    ['ID do número (WHATSAPP_PHONE_NUMBER_ID)', d.phoneNumberIdSet],
    ['Token de verificação do webhook (WHATSAPP_VERIFY_TOKEN)', d.verifyTokenSet],
    ['Chave secreta do app (WHATSAPP_APP_SECRET)', d.appSecretSet],
  ];
  const ready = items.every(([, ok]) => ok);
  return (
    <div className="space-y-4">
      <div className={`card p-5 text-sm ${ready ? 'border-emerald-200' : 'border-amber-300'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="section-title">Bot de WhatsApp</h2>
            <p className="mt-0.5 text-slate-500">
              Os colaboradores consultam o estoque, fazem reservas e pedem compras pelo WhatsApp. O número de cada um é o login:
              só números cadastrados em <b>Usuários</b> são atendidos; números desconhecidos não recebem resposta.
            </p>
          </div>
          <span className={`chip ${ready ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}`}>{ready ? 'Configurado' : 'Configuração pendente'}</span>
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {items.map(([label, ok]) => (
            <li key={label} className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} /> {label}: <b>{ok ? 'definido' : 'faltando'}</b></li>
          ))}
        </ul>
        <div className="mt-4">
          <div className="label">URL do webhook (cadastrar no app da Meta, campo "Callback URL")</div>
          <div className="break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs ring-1 ring-slate-200">{d.webhookUrl}</div>
          <p className="mt-1 text-xs text-slate-500">No painel da Meta, assine o campo <b>messages</b> do webhook. Os valores secretos ficam só nas variáveis do servidor (Railway), nunca aqui.</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"><div className="label">Colaboradores com WhatsApp cadastrado</div><div className="text-2xl font-bold">{d.linkedUsers}</div></div>
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"><div className="label">Mensagens atendidas (7 dias)</div><div className="text-2xl font-bold">{d.messagesLast7Days}</div></div>
        </div>
      </div>
      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h2 className="section-title">Números não cadastrados que tentaram usar o bot (30 dias)</h2>
          <p className="mt-0.5 text-xs text-slate-500">Eles não receberam resposta. Se for um colaborador, cadastre o número em Usuários.</p>
        </div>
        {d.unauthorized.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Nenhuma tentativa.</p>
        ) : (
          <Table columns={['Número', 'Tentativas', 'Última']}>
            {d.unauthorized.map((u: any) => (
              <tr key={u.phone}><td className="td font-mono text-xs">{u.phone}</td><td className="td tabular-nums">{u.attempts}</td><td className="td text-xs">{dateTime(u.last)}</td></tr>
            ))}
          </Table>
        )}
      </section>
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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const suggest = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ applied: { name: string; label: string }[]; skipped: { name: string }[] }>('/api/admin/situations/suggest');
      setResult(
        `Configuradas: ${r.applied.map((a) => a.name).join(', ') || 'nenhuma'}.` +
          (r.skipped.length ? ` Sem sugestão (configure manualmente): ${r.skipped.map((x) => x.name).join(', ')}.` : ''),
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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
      {editable && rows.some((r) => !r.category) && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-brand-200 bg-brand-50 p-4">
          <p className="text-sm text-brand-900">
            {rows.filter((r) => !r.category).length === 1 ? <>Há <b>1</b> situação sem regra.</> : <>Há <b>{rows.filter((r) => !r.category).length}</b> situações sem regra.</>} O sistema pode configurar automaticamente pelo nome
            (Atendido, Cancelado, Em aberto…), de forma conservadora. Você pode ajustar depois.
          </p>
          <button className="btn-primary" onClick={suggest} disabled={busy}>{busy ? 'Aplicando…' : 'Aplicar configuração recomendada'}</button>
        </div>
      )}
      {result && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{result}</p>}
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
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'vendedor', blingSellerId: '', whatsappPhone: '' });
  const [error, setError] = useState<string | null>(null);
  const load = () => api.get<{ users: any[] }>('/api/admin/users').then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/admin/users', { ...form, blingSellerId: form.blingSellerId ? Number(form.blingSellerId) : null, whatsappPhone: form.whatsappPhone || null });
      setForm({ username: '', name: '', password: '', role: 'vendedor', blingSellerId: '', whatsappPhone: '' });
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
  const pending = users.filter((u) => u.pending_approval);
  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <section className="card border-amber-300 bg-amber-50/60 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-900">Cadastros aguardando aprovação ({pending.length})</h2>
          <ul className="space-y-2">
            {pending.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 ring-1 ring-amber-200">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">{u.name}</div>
                  <div className="truncate text-xs text-slate-500">{u.email ?? u.username} · e-mail confirmado · entra como Vendedor</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => update(u.id, { approve: true })}>Aprovar</button>
                  <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => { if (confirm(`Recusar o acesso de ${u.name}?`)) void update(u.id, { approve: false }); }}>Recusar</button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-900">Depois de aprovar, ajuste o perfil (Gestor/Administrador) na tabela abaixo, se necessário.</p>
        </section>
      )}
      <form onSubmit={create} className="card grid gap-3 p-4 sm:grid-cols-6">
        <h2 className="text-sm font-semibold sm:col-span-6">Novo usuário</h2>
        <div><label className="label" htmlFor="nu-user">Usuário (login)</label><input id="nu-user" className="input" autoCapitalize="none" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="nu-name">Nome completo</label><input id="nu-name" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="nu-pass">Senha inicial</label><input id="nu-pass" className="input" type="password" autoComplete="new-password" required minLength={10} placeholder="mín. 10, letras e números" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        <div><label className="label" htmlFor="nu-role">Perfil</label><select id="nu-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="vendedor">Vendedor</option><option value="gestor">Gestor</option><option value="admin">Administrador</option>
        </select></div>
        <div><label className="label" htmlFor="nu-seller" title="Código do vendedor no Bling: liga os pedidos do Bling a este usuário">Cód. vendedor no Bling</label><input id="nu-seller" className="input" inputMode="numeric" placeholder="opcional" value={form.blingSellerId} onChange={(e) => setForm({ ...form, blingSellerId: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="nu-wa" title="Número que poderá usar o bot de WhatsApp. Sem número, a pessoa não é atendida pelo bot.">WhatsApp (login do bot)</label><input id="nu-wa" className="input" inputMode="tel" placeholder="(11) 98765-4321 — opcional" value={form.whatsappPhone} onChange={(e) => setForm({ ...form, whatsappPhone: e.target.value })} /></div>
        <button className="btn-primary sm:col-span-6 sm:justify-self-end">Criar usuário</button>
      </form>
      <ErrorMsg error={error} />
      <div className="card overflow-hidden">
        <Table columns={['Usuário', 'Nome', 'Perfil', '2 etapas', 'Cód. vendedor Bling', 'WhatsApp', 'Ativo', '']}>
          {users.map((u) => (
            <tr key={u.id}>
              <td className="td font-mono text-xs">{u.username}</td>
              <td className="td">
                {u.name}
                {u.email && u.email !== u.username && <div className="text-xs text-slate-400">{u.email}</div>}
                {u.locked_until && new Date(u.locked_until) > new Date() && <span className="ml-2 text-xs text-rose-600">bloqueado temporariamente (senha errada)</span>}
                {u.pending_approval && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">Aguardando aprovação</span>
                    <button className="btn-primary px-2 py-1 text-xs" onClick={() => update(u.id, { approve: true })}>Aprovar</button>
                    <button className="btn-secondary px-2 py-1 text-xs" onClick={() => { if (confirm(`Recusar o acesso de ${u.name}?`)) void update(u.id, { approve: false }); }}>Recusar</button>
                  </div>
                )}
              </td>
              <td className="td">
                <select className="input min-w-[9.5rem]" aria-label={`Perfil de ${u.name}`} value={u.role} onChange={(e) => update(u.id, { role: e.target.value })}>
                  <option value="vendedor">Vendedor</option><option value="gestor">Gestor</option><option value="admin">Administrador</option>
                </select>
              </td>
              <td className="td text-xs">{u.mfa_enabled ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">Ativo</span> : <span className="text-slate-400">—</span>}</td>
              <td className="td"><input className="input w-28" inputMode="numeric" aria-label={`Código do vendedor no Bling de ${u.name}`} defaultValue={u.bling_seller_id ?? ''} onBlur={(e) => update(u.id, { blingSellerId: e.target.value ? Number(e.target.value) : null })} /></td>
              <td className="td">
                <input
                  className="input w-44"
                  inputMode="tel"
                  placeholder="sem bot"
                  aria-label={`WhatsApp de ${u.name}`}
                  defaultValue={u.whatsapp_phone ? formatPhone(u.whatsapp_phone) : ''}
                  key={u.whatsapp_phone ?? 'none'}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if ((v || null) !== (u.whatsapp_phone ? formatPhone(u.whatsapp_phone) : null)) void update(u.id, { whatsappPhone: v || null });
                  }}
                />
              </td>
              <td className="td"><input type="checkbox" aria-label={`${u.name} ativo`} checked={u.active} onChange={(e) => update(u.id, { active: e.target.checked })} /></td>
              <td className="td">
                <div className="flex flex-wrap gap-1">
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => { const p = prompt('Nova senha (mín. 10 caracteres, letras e números):'); if (p) void update(u.id, { password: p }); }}>Redefinir senha</button>
                  {u.mfa_enabled && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => { if (confirm(`Refazer o 2FA de ${u.name}? No próximo login a pessoa cadastra o app autenticador de novo (use se ela perdeu o celular).`)) void update(u.id, { resetMfa: true }); }}>Refazer 2FA</button>}
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => { if (confirm(`Desconectar ${u.name} de todos os aparelhos?`)) void update(u.id, { revokeSessions: true }); }}>Encerrar sessões</button>
                </div>
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
        <h2 className="text-sm font-semibold text-slate-800 sm:col-span-3">Cálculo de disponibilidade</h2>
        <div>
          <label className="label">Base do cálculo de disponibilidade</label>
          <select className="input" disabled={!editable} value={s.engine.baseMode} onChange={(e) => set('engine', 'baseMode', e.target.value)}>
            <option value="PHYSICAL">Estoque físico (recomendado)</option>
            <option value="VIRTUAL">Saldo virtual do Bling</option>
          </select>
        </div>
        {numField('engine', 'maxBalanceAgeMinutes', 'Saldo considerado atualizado por até (min)')}
        {numField('engine', 'criticalRefreshMinutes', 'Ao verificar uma venda, buscar saldo novo no Bling se tiver mais de (min)')}
        {numField('engine', 'ordersMaxAgeMinutes', 'Pedidos considerados atualizados por até (min)')}
        <div>
          <label className="label">Quando uma reserva vence</label>
          <select className="input" disabled={!editable} value={s.engine.expiredReservationPolicy} onChange={(e) => set('engine', 'expiredReservationPolicy', e.target.value)}>
            <option value="KEEP_UNTIL_REVIEW">Continua descontando até o gestor revisar</option>
            <option value="AUTO_RELEASE">Libera as unidades automaticamente</option>
          </select>
        </div>
      </section>
      <section className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
        <h2 className="text-sm font-semibold text-slate-800 sm:col-span-3">Sincronização com o Bling</h2>
        {numField('sync', 'incrementalMinutes', 'Sincronização automática a cada (min)')}
        {numField('sync', 'reconcileMinutes', 'Conferência completa dos pedidos a cada (min)')}
        {numField('sync', 'initialLookbackDays', 'Importar pedidos dos últimos (dias)')}
      </section>
      <section className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
        <h2 className="text-sm font-semibold text-slate-800 sm:col-span-3">Reservas e privacidade</h2>
        {numField('reservations', 'defaultValidityHours', 'Validade padrão da reserva (h)')}
        {numField('reservations', 'maxValidityDays', 'Validade máxima da reserva (dias)')}
        {numField('reservations', 'expiringSoonHours', 'Avisar vencimento da reserva com antecedência de (h)')}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={s.reservations.autoApproveSellers} onChange={(e) => set('reservations', 'autoApproveSellers', e.target.checked)} /> Aprovar automaticamente reservas de vendedores quando houver saldo confirmado</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={s.privacy.sellersSeeAllCustomers} onChange={(e) => set('privacy', 'sellersSeeAllCustomers', e.target.checked)} /> Vendedores veem clientes de outros vendedores</label>
      </section>
      <section className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
        <h2 className="text-sm font-semibold text-slate-800 sm:col-span-3">Segurança</h2>
        <div className="sm:col-span-3 text-sm text-slate-700">Verificação em duas etapas (app autenticador) obrigatória para:</div>
        {(['admin', 'gestor', 'vendedor'] as const).map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!editable || r === 'admin'}
              checked={s.security.mfaRequiredFor.includes(r)}
              onChange={(e) => set('security', 'mfaRequiredFor', e.target.checked ? [...s.security.mfaRequiredFor, r] : s.security.mfaRequiredFor.filter((x: string) => x !== r))}
            />
            {r === 'admin' ? 'Administradores (sempre)' : r === 'gestor' ? 'Gestores' : 'Vendedores'}
          </label>
        ))}
      </section>
      <section className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
        <h2 className="text-sm font-semibold text-slate-800 sm:col-span-3">Cadastro de novos usuários</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={s.signup.enabled} onChange={(e) => set('signup', 'enabled', e.target.checked)} /> Permitir "Criar conta" na tela de login</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!editable} checked={s.signup.requireApproval} onChange={(e) => set('signup', 'requireApproval', e.target.checked)} /> Novas contas precisam de aprovação do administrador</label>
        <div>
          <label className="label">Aceitar somente e-mails destes domínios (separe por vírgula; vazio = qualquer)</label>
          <input
            className="input"
            disabled={!editable}
            placeholder="itcomtech.com.br"
            defaultValue={s.signup.allowedDomains.join(', ')}
            onBlur={(e) => set('signup', 'allowedDomains', e.target.value.split(',').map((d) => d.trim()).filter(Boolean))}
          />
        </div>
      </section>
      <section className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
        <h2 className="text-sm font-semibold text-slate-800 sm:col-span-3">Alertas</h2>
        {numField('alerts', 'committedWithoutPostingDays', 'Alerta: pedido confirmado sem baixa há mais de (dias)')}
        {numField('alerts', 'staleOpportunityDays', 'Alerta: pré-pedido parado há mais de (dias)')}
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
        <h2 className="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-900">Execuções</h2>
        <Table columns={['Início', 'Etapa', 'Resultado', 'Itens', 'Origem', 'Erro']}>
          {(data?.runs ?? []).map((r: any) => (
            <tr key={r.id}>
              <td className="td text-xs">{dateTime(r.started_at)}</td><td className="td">{SYNC_RESOURCE[r.kind] ?? r.kind}</td>
              <td className={`td text-xs font-semibold ${r.status === 'error' ? 'text-rose-600' : r.status === 'success' ? 'text-emerald-600' : 'text-slate-500'}`}>{SYNC_STATUS[r.status] ?? r.status}</td>
              <td className="td tabular-nums">{r.items}</td><td className="td text-xs">{syncOrigin(r.triggered_by)}</td><td className="td text-xs text-rose-700">{r.error}</td>
            </tr>
          ))}
        </Table>
      </section>
      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-900">Fila de processamento</h2>
        <Table columns={['Tarefa', 'Situação', 'Tentativas', 'Próxima execução', 'Erro']}>
          {(data?.jobs ?? []).map((j: any) => (
            <tr key={j.id}><td className="td">{JOB_TYPE[j.type] ?? j.type}</td><td className="td text-xs">{JOB_STATUS[j.status] ?? j.status}</td><td className="td text-xs">{j.attempts}/{j.max_attempts}</td><td className="td text-xs">{dateTime(j.run_at)}</td><td className="td text-xs text-rose-700">{j.last_error}</td></tr>
          ))}
        </Table>
      </section>
      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-slate-900">Avisos recebidos do Bling (webhooks)</h2>
        <Table columns={['Recebido', 'Evento', 'Código no Bling', 'Situação', 'Observação']}>
          {(data?.webhooks ?? []).map((w: any) => (
            <tr key={w.event_id}><td className="td text-xs">{dateTime(w.received_at)}</td><td className="td text-xs">{w.resource}.{w.action}</td><td className="td text-xs">{w.resource_id}</td><td className="td text-xs">{WEBHOOK_STATUS[w.status] ?? w.status}</td><td className="td text-xs">{w.note}</td></tr>
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
      <Table columns={['Quando', 'Usuário', 'Ação', 'Item afetado', 'Detalhes', 'IP']}>
        {rows.map((a) => (
          <tr key={a.id}>
            <td className="td text-xs">{dateTime(a.at)}</td><td className="td text-xs">{a.user_name ?? '—'}</td><td className="td text-xs" title={a.action}>{AUDIT_ACTION[a.action] ?? a.action}</td>
            <td className="td text-xs">{auditEntity(a.entity, a.entity_id)}</td>
            <td className="td max-w-xs truncate text-xs" title={auditDetails(a.details)}>{auditDetails(a.details)}</td><td className="td text-xs">{a.ip}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
