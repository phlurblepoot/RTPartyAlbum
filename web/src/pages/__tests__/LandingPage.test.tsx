import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PublicEvent } from '@rtpa/shared';
import LandingPage from '../LandingPage';

vi.mock('../../api/client', () => ({ getActiveEvent: vi.fn() }));
import { getActiveEvent } from '../../api/client';

const activeEvent = { code: 'PARTY1', name: "Sarah's 30th" } as unknown as PublicEvent;

function renderLanding() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LandingPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always shows an admin console link', async () => {
    (getActiveEvent as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    renderLanding();
    expect(await screen.findByRole('link', { name: /admin console/i })).toHaveAttribute('href', '/admin');
  });

  it('links upload and canvas to the active event when one is active', async () => {
    (getActiveEvent as ReturnType<typeof vi.fn>).mockResolvedValue(activeEvent);
    renderLanding();
    expect(await screen.findByTestId('upload-link')).toHaveAttribute('href', '/e/PARTY1');
    expect(screen.getByTestId('canvas-link')).toHaveAttribute('href', '/e/PARTY1/display');
    expect(screen.getByText(/sarah's 30th/i)).toBeInTheDocument();
  });

  it('shows guidance and no upload/canvas links when no event is active', async () => {
    (getActiveEvent as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    renderLanding();
    expect(await screen.findByTestId('no-active-event')).toBeInTheDocument();
    expect(screen.queryByTestId('upload-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canvas-link')).not.toBeInTheDocument();
  });
});
