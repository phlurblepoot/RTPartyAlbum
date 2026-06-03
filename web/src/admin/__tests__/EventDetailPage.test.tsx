import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { EventDetailPage } from '../event/EventDetailPage';
import { renderWithProviders } from './helpers/renderWithProviders';
import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';
import type { EventDetail } from '@rtpa/shared';

vi.mock('../api', () => ({ adminApi: { getEvent: vi.fn() } }));
import { adminApi } from '../api';

// stub heavy tab children so this test only exercises tab switching
vi.mock('../event/AlbumTab', () => ({ AlbumTab: () => <div>ALBUM TAB</div> }));
vi.mock('../event/DisplayTab', () => ({ DisplayTab: () => <div>DISPLAY TAB</div> }));
vi.mock('../event/ShareTab', () => ({ ShareTab: () => <div>SHARE TAB</div> }));

const detail: EventDetail = {
  id: 'e1', code: 'ABCD', name: 'Sara Birthday', createdAt: '2026-06-01T12:00:00.000Z',
  isActive: true, uploadEnabled: true, status: 'active', themeId: 'preset-midnight-gala',
  photoCount: 3, motionConfig: DEFAULT_MOTION_CONFIG,
};

describe('EventDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminApi.getEvent as ReturnType<typeof vi.fn>).mockResolvedValue(detail);
  });

  it('loads event and shows Album tab by default, switches tabs', async () => {
    renderWithProviders(
      <Routes><Route path="/admin/events/:eventId" element={<EventDetailPage />} /></Routes>,
      { route: '/admin/events/e1' },
    );
    expect(await screen.findByText('Sara Birthday')).toBeInTheDocument();
    expect(screen.getByText('ALBUM TAB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /display/i }));
    expect(screen.getByText('DISPLAY TAB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /qr & share/i }));
    expect(screen.getByText('SHARE TAB')).toBeInTheDocument();
  });
});
