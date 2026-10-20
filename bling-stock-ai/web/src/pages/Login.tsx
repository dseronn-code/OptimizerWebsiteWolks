import { BRAND } from '../brand';
import { useState } from 'react';
import { useAuth } from '../auth';

export default function Login() {
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
    <div className="flex min-h-full flex-col bg-brand-900">
      <div className="h-1.5 bg-brand-600" />
      <div className="flex flex-1 items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex flex-col items-center gap-2 pb-2 text-center">
          <img src={BRAND.logo} alt={BRAND.company} className="h-12 w-auto" />
          <div>
            <h1 className="text-base font-semibold text-brand-900">{BRAND.appName}</h1>
            <p className="text-xs text-slate-500">{BRAND.tagline}</p>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="u">Usuário</label>
          <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="p">Senha</label>
          <input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      </div>
      <p className="pb-4 text-center text-xs text-brand-200">{BRAND.company} · uso interno</p>
    </div>
  );
}
