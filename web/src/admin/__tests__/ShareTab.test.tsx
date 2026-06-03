import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareTab } from '../event/ShareTab';
import { renderWithProviders } from './helpers/renderWithProviders';
import { DEFAULT_MOTION_CONFIG, DEFAULT_MEDIA_LIMITS } from '@rtpa/shared';
import type { EventDetail } from '@rtpa/shared';

vi.mock('../api', () => ({
  adminApi: {
    getSettings: vi.fn(),
    qrUrl: (id: string) => `/api/admin/events/${id}/qr`,
    setUploadState: vi.fn(),
    endEvent: vi.fn(),
  },
}));
import { adminApi } from '../api';

const event: EventDetail = {
  id: 'e1', code: 'ABCD', name: 'Sara', createdAt: '2026-06-01T12:00:00.000Z',
  isActive: true, uploadEnabled: true, status: 'active', themeId: 'preset-midnight-gala',
  photoCount: 3, motionConfig: DEFAULT_MOTION_CONFIG,
};

describe('ShareTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminApi.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      publicBaseUrl: 'https://party.test', mediaLimits: DEFAULT_MEDIA_LIMITS,
    });
    (adminApi.setUploadState as ReturnType<typeof vi.fn>).mockResolvedValue({ ...event, uploadEnabled: false });
    (adminApi.endEvent as ReturnType<typeof vi.fn>).mockResolvedValue({ ...event, status: 'ended' });
  });

  it('shows upload link and qr image', async () => {
    renderWithProviders(<ShareTab event={event} />);
    expect(await screen.findByText('https://party.test/e/ABCD')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /qr/i })).toHaveAttribute('src', '/api/admin/events/e1/qr');
  });

  it('print button calls window.print', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderWithProviders(<ShareTab event={event} />);
    await screen.findByText('https://party.test/e/ABCD');
    await userEvent.click(screen.getByRole('button', { name: /print/i }));
    expect(printSpy).toHaveBeenCalled();
  });

  it('pause toggle calls setUploadState with false', async () => {
    renderWithProviders(<ShareTab event={event} />);
    await screen.findByText('https://party.test/e/ABCD');
    await userEvent.click(screen.getByRole('button', { name: /pause uploads/i }));
    await waitFor(() => expect(adminApi.setUploadState).toHaveBeenCalledWith('e1', false));
  });

  it('end event confirms then calls endEvent', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<ShareTab event={event} />);
    await screen.findByText('https://party.test/e/ABCD');
    await userEvent.click(screen.getByRole('button', { name: /end event/i }));
    await waitFor(() => expect(adminApi.endEvent).toHaveBeenCalledWith('e1'));
  });
});
