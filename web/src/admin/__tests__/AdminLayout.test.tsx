import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminLayout } from '../AdminLayout';

const logout = vi.fn();
vi.mock('../AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', login: vi.fn(), logout }),
}));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/admin/events']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="events" element={<div>EVENTS PANE</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nav links and child outlet', () => {
    renderShell();
    expect(screen.getByRole('link', { name: /events/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /themes/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByText('EVENTS PANE')).toBeInTheDocument();
  });

  it('logout button calls logout', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(logout).toHaveBeenCalled();
  });
});
