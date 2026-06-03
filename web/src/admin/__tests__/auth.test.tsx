import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../AuthContext';
import { LoginPage } from '../LoginPage';
import { RequireAdmin } from '../RequireAdmin';

vi.mock('../api', () => {
  const ApiError = class extends Error { status: number; constructor(s: number, m: string){ super(m); this.status = s; } };
  return {
    ApiError,
    adminApi: {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
    },
  };
});
import { adminApi, ApiError } from '../api';

function Protected() {
  return (
    <AuthProvider>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin/login" element={<LoginPage />} />
          <Route path="/admin" element={<RequireAdmin><div>SECRET</div></RequireAdmin>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('admin auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirects to login when /me rejects 401', async () => {
    (adminApi.me as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'no'));
    render(<Protected />);
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
  });

  it('shows secret when /me resolves', async () => {
    (adminApi.me as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    render(<Protected />);
    expect(await screen.findByText('SECRET')).toBeInTheDocument();
  });

  it('login success transitions to authenticated', async () => {
    (adminApi.me as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ApiError(401, 'no'));
    (adminApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<Protected />);
    const input = await screen.findByLabelText(/password/i);
    await userEvent.type(input, 'hunter2');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    await waitFor(() => expect(screen.getByText('SECRET')).toBeInTheDocument());
  });

  it('wrong password shows error on 401', async () => {
    (adminApi.me as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'no'));
    (adminApi.login as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'bad'));
    render(<Protected />);
    const input = await screen.findByLabelText(/password/i);
    await userEvent.type(input, 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByText(/incorrect password/i)).toBeInTheDocument();
  });

  it('rate-limit shows message on 429', async () => {
    (adminApi.me as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'no'));
    (adminApi.login as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(429, 'slow'));
    render(<Protected />);
    const input = await screen.findByLabelText(/password/i);
    await userEvent.type(input, 'x');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });
});
