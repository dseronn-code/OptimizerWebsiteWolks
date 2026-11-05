import { ArrowLeft, KeyRound, MailCheck, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { BRAND } from '../brand';
import { primeIntroAudio } from '../components/Intro';

type Mode = 'login' | 'signup' | 'code' | 'pending' | 'mfa-verify' | 'mfa-setup';

interface SignupStatus {
  enabled: boolean;
  requireApproval: boolean;
  allowedDomains: string[];
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [signup, setSignup] = useState<SignupStatus | null>(null);
  const [pendingEmail, setPendingEmail] = useState<{ verificationId: string; email: string } | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);

  useEffect(() => {
    api.get<SignupStatus>('/api/auth/signup').then(setSignup).catch(() => setSignup(null));
  }, []);

  return (
    // qualquer clique/tecla na tela de login libera o som da abertura (exigência dos navegadores)
    <div className="flex min-h-full bg-white" onClickCapture={primeIntroAudio} onKeyDownCapture={primeIntroAudio}>
      {/* painel da marca (somente telas grandes) */}
      <div className="relative hidden w-[46%] max-w-2xl flex-col justify-between overflow-hidden bg-brand-950 p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-500/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 right-[-6rem] h-[30rem] w-[30rem] rounded-full bg-accent-500/15 blur-3xl" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)', backgroundSize: '44px 44px' }}
          aria-hidden
        />
        <img src={BRAND.logoOnDark} alt={BRAND.company} className="relative h-10 w-auto self-start" />
        <div className="relative max-w-md animate-fade-up">
          <span className="chip bg-white/10 text-brand-100 ring-white/15"><ShieldCheck size={13} /> Somente leitura no Bling</span>
          <h2 className="mt-5 text-4xl font-bold leading-tight tracking-tight">
            O estoque real,<br />
            <span className="bg-gradient-to-r from-accent-500 to-brand-200 bg-clip-text text-transparent">pronto para vender.</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-brand-100/80">
            Saldo do Bling menos pedidos, reservas e bloqueios ainda não baixados, sem contar nada duas vezes. Pergunte em linguagem natural e receba a resposta com o cálculo.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-brand-100/90">
            {['Disponibilidade confirmada produto a produto', 'Assistente com IA para a equipe comercial', 'Alertas de divergência e reservas vencendo'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15"><ShieldCheck size={13} /></span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-300/70">© {new Date().getFullYear()} {BRAND.company} · uso interno</p>
      </div>

      {/* formulário */}
      <div className="flex flex-1 flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-white px-5 py-10">
        <div className="w-full max-w-sm animate-fade-up space-y-6">
          <div className="flex flex-col items-center gap-3 text-center lg:items-start lg:text-left">
            <img src={BRAND.logo} alt={BRAND.company} className="h-11 w-auto lg:hidden" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{BRAND.appName}</h1>
              <p className="mt-1 text-sm text-slate-500">{BRAND.tagline}</p>
            </div>
          </div>
          <div className="card space-y-4 p-6 sm:p-7">
          {mode === 'login' && (
            <LoginForm
              canSignup={Boolean(signup?.enabled)}
              onSignup={() => setMode('signup')}
              onMfa={(step, ch) => {
                setChallenge(ch);
                setMode(step === 'verify' ? 'mfa-verify' : 'mfa-setup');
              }}
            />
          )}
          {mode === 'mfa-verify' && challenge && <MfaVerifyForm challenge={challenge} onRestart={() => setMode('login')} />}
          {mode === 'mfa-setup' && challenge && <MfaSetupForm challenge={challenge} onRestart={() => setMode('login')} />}
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
          <p className="text-center text-xs text-slate-400 lg:hidden">{BRAND.company} · uso interno</p>
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{children}</p>;
}

function LoginForm({ canSignup, onSignup, onMfa }: { canSignup: boolean; onSignup: () => void; onMfa: (step: 'verify' | 'setup', challenge: string) => void }) {
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
      const r = await login(username, password);
      if ('mfa' in r) onMfa(r.mfa, r.challenge);
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

function MfaVerifyForm({ challenge, onRestart }: { challenge: string; onRestart: () => void }) {
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ recoveryCodesLeft: number | null }>('/api/auth/mfa/verify', { challenge, code });
      if (r.recoveryCodesLeft !== null) alert(`Você usou um código de recuperação. Restam ${r.recoveryCodesLeft}. Se perdeu o celular, peça ao administrador para refazer seu 2FA.`);
      await refresh();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      if (/Entre novamente/.test(msg)) setTimeout(onRestart, 2500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="text-center">
        <ShieldCheck className="mx-auto text-brand-600" size={36} />
        <h2 className="mt-2 font-semibold text-slate-900">Verificação em duas etapas</h2>
        <p className="text-sm text-slate-600">
          {useRecovery ? 'Digite um dos seus códigos de recuperação.' : 'Abra o app autenticador no celular e digite o código de 6 dígitos.'}
        </p>
      </div>
      <input
        className="input text-center text-2xl font-semibold tracking-[0.3em]"
        inputMode={useRecovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        maxLength={useRecovery ? 11 : 6}
        placeholder={useRecovery ? 'XXXXX-XXXXX' : '000000'}
        value={code}
        onChange={(e) => setCode(useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-label="Código de verificação"
        autoFocus
        required
      />
      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn-primary w-full" disabled={busy || code.length < 6}>{busy ? 'Verificando…' : 'Entrar'}</button>
      <button type="button" className="w-full text-sm text-brand-600" onClick={() => { setUseRecovery((v) => !v); setCode(''); }}>
        {useRecovery ? 'Usar o código do app autenticador' : 'Perdi o celular: usar código de recuperação'}
      </button>
    </form>
  );
}

function MfaSetupForm({ challenge, onRestart }: { challenge: string; onRestart: () => void }) {
  const { refresh } = useAuth();
  const [qr, setQr] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.post<{ secret: string; qrDataUrl: string }>('/api/auth/mfa/setup', { challenge }).then(setQr).catch((err) => setError((err as Error).message));
  }, [challenge]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ recoveryCodes: string[] }>('/api/auth/mfa/setup/confirm', { challenge, code });
      setCodes(r.recoveryCodes);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      if (/Entre novamente/.test(msg)) setTimeout(onRestart, 2500);
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <KeyRound className="mx-auto text-emerald-600" size={36} />
          <h2 className="mt-2 font-semibold text-slate-900">Guarde seus códigos de recuperação</h2>
          <p className="text-sm text-slate-600">Se perder o celular, cada código abaixo permite entrar <b>uma vez</b>. Anote em papel ou num lugar seguro. Eles não serão mostrados de novo.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm">
          {codes.map((c) => <span key={c} className="text-center">{c}</span>)}
        </div>
        <button className="btn-primary w-full" onClick={() => refresh()}>Já guardei, entrar no sistema</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="text-center">
        <ShieldCheck className="mx-auto text-brand-600" size={36} />
        <h2 className="mt-2 font-semibold text-slate-900">Ative a verificação em duas etapas</h2>
        <p className="text-sm text-slate-600">Obrigatória para o seu perfil. Use um app autenticador gratuito: <b>Google Authenticator</b> ou <b>Microsoft Authenticator</b>.</p>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>Instale o app no celular.</li>
        <li>No app, toque em <b>+</b> e <b>Ler código QR</b>.</li>
        <li>Aponte para o QR abaixo e digite o código de 6 dígitos que aparecer.</li>
      </ol>
      {qr ? (
        <div className="flex flex-col items-center gap-2">
          <img src={qr.qrDataUrl} alt="QR Code para o app autenticador" className="h-48 w-48 rounded-lg ring-1 ring-slate-200" />
          <details className="text-center text-xs text-slate-500">
            <summary className="cursor-pointer">Está no próprio celular? Digite esta chave no app</summary>
            <code className="mt-1 block break-all font-mono text-slate-700">{qr.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          </details>
        </div>
      ) : (
        !error && <p className="text-center text-sm text-slate-500">Gerando QR Code…</p>
      )}
      <input
        className="input text-center text-2xl font-semibold tracking-[0.5em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-label="Código do app autenticador"
        required
      />
      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn-primary w-full" disabled={busy || code.length !== 6 || !qr}>{busy ? 'Confirmando…' : 'Confirmar e ativar'}</button>
    </form>
  );
}
