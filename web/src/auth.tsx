import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { User } from './types';

/** Resultado do login: concluído ou falta a verificação em duas etapas. */
export type LoginStep = { done: true } | { mfa: 'verify' | 'setup'; challenge: string };

interface AuthState {
  user: User | null;
  appMode: 'demo' | 'live' | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginStep>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appMode, setAppMode] = useState<'demo' | 'live' | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User; appMode: 'demo' | 'live' }>('/api/auth/me');
      setUser(r.user);
      setAppMode(r.appMode);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setUser(null);
    window.addEventListener('bsa:unauthorized', onUnauthorized);
    return () => window.removeEventListener('bsa:unauthorized', onUnauthorized);
  }, [refresh]);

  const login = async (username: string, password: string): Promise<LoginStep> => {
    const r = await api.post<{ user?: User; mfa?: 'verify' | 'setup'; challenge?: string }>('/api/auth/login', { username, password });
    if (r.mfa && r.challenge) return { mfa: r.mfa, challenge: r.challenge };
    await refresh();
    return { done: true };
  };
  const logout = async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  };

  return <Ctx.Provider value={{ user, appMode, loading, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider ausente');
  return c;
}
