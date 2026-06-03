import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { adminApi, ApiError } from './api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let alive = true;
    adminApi
      .me()
      .then(() => { if (alive) setStatus('authenticated'); })
      .catch(() => { if (alive) setStatus('unauthenticated'); });
    return () => { alive = false; };
  }, []);

  const login = useCallback(async (password: string) => {
    await adminApi.login(password); // throws ApiError on 401/429
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try { await adminApi.logout(); } catch { /* ignore */ }
    setStatus('unauthenticated');
  }, []);

  return (
    <AuthContext.Provider value={{ status, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { ApiError };
