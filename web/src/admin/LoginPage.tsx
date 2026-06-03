import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, SessionError } from './AuthContext';
import { ApiError } from './api';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(password);
      navigate('/admin', { replace: true });
    } catch (err) {
      if (err instanceof SessionError) {
        setError(
          'Password accepted, but your browser did not keep the session. This usually means the site is served over plain HTTP — try the HTTPS address.',
        );
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Please wait and try again.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Incorrect password.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-auth">
      <form onSubmit={onSubmit} aria-label="Admin login">
      <h1>Admin Login</h1>
      <label htmlFor="admin-password">Password</label>
      <input
        id="admin-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>Log in</button>
      </form>
    </div>
  );
}
