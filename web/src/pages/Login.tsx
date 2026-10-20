import { ArrowLeft, MailCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { BRAND } from '../brand';

type Mode = 'login' | 'signup' | 'code' | 'pending';

interface SignupStatus {
  enabled: boolean;
  requireApproval: boolean;
  allowedDomains: string[];
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [signup, setSignup] = useState<SignupStatus | null>(null);
  const [pendingEmail, setPendingEmail] = useState<{ verificationId: string; email: string } | null>(null);

  useEffect(() => {
    api.get<SignupStatus>('/api/auth/signup').then(setSignup).catch(() => setSignup(null));
  }, []);

  return (
    <div className="flex min-h-full flex-col bg-brand-900">
      <div className="h-1.5 bg-brand-600" />
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="card w-full max-w-sm space-y-4 p-6">
          <div className="flex flex-col items-center gap-2 pb-2 text-center">
            <img src={BRAND.logo} alt={BRAND.company} className="h-12 w-auto" />
            <div>
              <h1 className="text-base font-semibold text-brand-900">{BRAND.appName}</h1>
              <p className="text-xs text-slate-500">{BRAND.tagline}</p>
            </div>
          </div>
          {mode === 'login' && <LoginForm canSignup={Boolean(signup?.enabled)} onSignup={() => setMode('signup')} />}
          {mode === 'signup' && signup && (
            <SignupForm
              status={signup}
              onBack={() => setMode('login')}
              onCodeSent={(v) => {
                setPendingEmail(v);
                setMode('code');
              }}
            />
          )}
          {mode === 'code' && pendingEmail && (
            <CodeForm data={pendingEmail} onBack={() => setMode('signup')} onPending={() => setMode('pending')} />
          )}
          {mode === 'pending' && (
            <div className="space-y-4 text-center">
              <MailCheck className="mx-auto text-emerald-600" size={40} />
              <p className="text-sm text-slate-700">
                E-mail confirmado e conta criada! Agora um administrador precisa <b>aprovar o seu acesso</b>. Você poderá entrar assim que for aprovado.
              </p>
              <button className="btn-secondary w-full" onClick={() => setMode('login')}>Voltar para o login</button>
            </div>
          )}
        </div>
      </div>
      <p className="pb-4 text-center text-xs text-brand-200">{BRAND.company} · uso interno</p>
    </div>
  );
}

function ErrorBox({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{children}</p>;
}

function LoginForm({ canSignup, onSignup }: { canSignup: boolean; onSignup: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="u">Usuário ou e-mail</label>
        <input id="u" className="input" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="p">Senha</label>
        <input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      {canSignup && (
        <p className="text-center text-sm text-slate-600">
          Não tem conta?{' '}
          <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={onSignup}>Criar conta</button>
        </p>
      )}
    </form>
  );
}

function SignupForm({ status, onBack, onCodeSent }: { status: SignupStatus; onBack: () => void; onCodeSent: (v: { verificationId: string; email: string }) => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError('As senhas não conferem.');
    setBusy(true);
    try {
      const r = await api.post<{ verificationId: string; email: string }>('/api/auth/signup/start', { name: form.name, email: form.email, password: form.password });
      onCodeSent(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600"><ArrowLeft size={16} /> Entrar</button>
      <h2 className="font-semibold text-slate-900">Criar conta</h2>
      <div>
        <label className="label" htmlFor="sn">Nome completo</label>
        <input id="sn" className="input" autoComplete="name" value={form.name} onChange={set('name')} required minLength={2} />
      </div>
      <div>
        <label className="label" htmlFor="se">E-mail{status.allowedDomains.length ? ` (${status.allowedDomains.map((d) => `@${d.replace(/^@/, '')}`).join(', ')})` : ''}</label>
        <input id="se" className="input" type="email" autoComplete="email" autoCapitalize="none" value={form.email} onChange={set('email')} required />
      </div>
      <div>
        <label className="label" htmlFor="sp">Senha (mín. 10 caracteres, com letras e números)</label>
        <input id="sp" className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={10} />
      </div>
      <div>
        <label className="label" htmlFor="sc">Confirmar senha</label>
        <input id="sc" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Enviando código…' : 'Enviar código por e-mail'}</button>
      {status.requireApproval && <p className="text-center text-xs text-slate-500">Após confirmar o e-mail, um administrador aprova o seu acesso.</p>}
    </form>
  );
}

function CodeForm({ data, onBack, onPending }: { data: { verificationId: string; email: string }; onBack: () => void; onPending: () => void }) {
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ status: 'active' | 'pending_approval' }>('/api/auth/signup/verify', { verificationId: data.verificationId, code });
      if (r.status === 'pending_approval') onPending();
      else await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      await api.post('/api/auth/signup/resend', { verificationId: data.verificationId });
      setInfo('Enviamos um novo código.');
      setCooldown(60);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600"><ArrowLeft size={16} /> Voltar</button>
      <div className="text-center">
        <MailCheck className="mx-auto text-brand-600" size={36} />
        <h2 className="mt-2 font-semibold text-slate-900">Confirme seu e-mail</h2>
        <p className="text-sm text-slate-600">Enviamos um código de 6 dígitos para <b>{data.email}</b>. Confira também a caixa de spam.</p>
      </div>
      <input
        className="input text-center text-2xl font-semibold tracking-[0.5em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-label="Código de confirmação"
        required
      />
      {error && <ErrorBox>{error}</ErrorBox>}
      {info && !error && <p className="text-center text-sm text-emerald-700">{info}</p>}
      <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? 'Confirmando…' : 'Confirmar e criar conta'}</button>
      <button type="button" className="w-full text-sm text-brand-600 disabled:text-slate-400" onClick={resend} disabled={cooldown > 0}>
        {cooldown > 0 ? `Reenviar código em ${cooldown}s` : 'Reenviar código'}
      </button>
    </form>
  );
}
