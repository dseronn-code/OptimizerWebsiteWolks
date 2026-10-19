import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  appMode: 'demo' | 'live' | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
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

  const login = async (username: string, password: string) => {
    await api.post('/api/auth/login', { username, password });
    await refresh();
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
