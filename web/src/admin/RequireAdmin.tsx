import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <p>Loading…</p>;
  if (status === 'unauthenticated') return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}
