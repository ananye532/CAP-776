import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized, setCsrfToken } from '../api/client';
import type { AuthStatus, User } from '../api/types';
import { applyTheme } from './hooks';

interface AuthCtx {
  status: AuthStatus | null;
  user: User | null;
  aiAvailable: boolean;
  refresh: () => Promise<void>;
  signedIn: (r: { user: User; csrfToken: string; aiAvailable: boolean }) => void;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<AuthStatus>('/auth/status');
      setCsrfToken(s.csrfToken ?? null);
      if (s.user) applyTheme(s.user.settings.theme);
      setStatus(s);
    } catch {
      setStatus({ hasUser: true, authenticated: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onUnauthorized(() => {
      setCsrfToken(null);
      qc.clear();
      setStatus((s) => (s ? { ...s, authenticated: false, user: undefined } : s));
    });
  }, [refresh, qc]);

  const value: AuthCtx = {
    status,
    user: status?.user ?? null,
    aiAvailable: !!status?.aiAvailable,
    refresh,
    signedIn: (r) => {
      setCsrfToken(r.csrfToken);
      applyTheme(r.user.settings.theme);
      setStatus({ hasUser: true, authenticated: true, user: r.user, csrfToken: r.csrfToken, aiAvailable: r.aiAvailable });
    },
    logout: async () => {
      try {
        await api.post('/auth/logout');
      } finally {
        setCsrfToken(null);
        qc.clear();
        setStatus({ hasUser: true, authenticated: false });
      }
    },
    setUser: (u) => {
      applyTheme(u.settings.theme);
      setStatus((s) => (s ? { ...s, user: u } : s));
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
