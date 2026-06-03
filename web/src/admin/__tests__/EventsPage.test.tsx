import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventsPage } from '../EventsPage';
import { renderWithProviders } from './helpers/renderWithProviders';
import type { EventSummary, EventDetail } from '@rtpa/shared';

vi.mock('../api', () => ({
  adminApi: { listEvents: vi.fn(), createEvent: vi.fn() },
}));
import { adminApi } from '../api';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const summary: EventSummary = {
  id: 'e1', code: 'ABCD', name: 'Sara Birthday', createdAt: '2026-06-01T12:00:00.000Z',
  isActive: true, uploadEnabled: true, status: 'active', themeId: 'preset-midnight-gala', photoCount: 7,
};
const created: EventDetail = { ...summary, id: 'e2', code: 'WXYZ', name: 'New', motionConfig: {} as never };

describe('EventsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminApi.listEvents as ReturnType<typeof vi.fn>).mockResolvedValue([summary]);
    (adminApi.createEvent as ReturnType<typeof vi.fn>).mockResolvedValue(created);
  });

  it('renders events with status badge and photo count', async () => {
    renderWithProviders(<EventsPage />);
    expect(await screen.findByText('Sara Birthday')).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it('create flow prompts, posts, navigates to detail', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('New');
    renderWithProviders(<EventsPage />);
    await screen.findByText('Sara Birthday');
    await userEvent.click(screen.getByRole('button', { name: /create event/i }));
    await waitFor(() => expect(adminApi.createEvent).toHaveBeenCalledWith('New'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin/events/e2'));
  });

  it('shows empty state when no events', async () => {
    (adminApi.listEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderWithProviders(<EventsPage />);
    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
  });
});
