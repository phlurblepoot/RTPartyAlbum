import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { adminApi, ApiError } from './api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Thrown when the password was accepted (login returned 200) but the browser
 * did not retain a usable session afterwards — e.g. it dropped a `Secure`
 * cookie received over plain HTTP. Distinct from an ApiError 401 (wrong
 * password) so the UI can give actionable guidance.
 */
export class SessionError extends Error {
  constructor() {
    super('session_not_established');
    this.name = 'SessionError';
  }
}

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
    // Login set an httpOnly session cookie. Don't trust the 200 alone — confirm
    // the browser actually stored and will send the cookie by making a real
    // authenticated request. This catches the case where a Secure cookie is
    // silently dropped (e.g. served over plain HTTP), which would otherwise let
    // the UI enter the admin panel only to have every request 401.
    try {
      await adminApi.me();
    } catch {
      setStatus('unauthenticated');
      throw new SessionError();
    }
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

