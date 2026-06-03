import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlbumTab } from '../event/AlbumTab';
import { renderWithProviders } from './helpers/renderWithProviders';
import { createFakeSocket, FakeSocket } from './helpers/fakeSocket';
import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';
import type { EventDetail, PhotoAdmin, Photo } from '@rtpa/shared';

let fakeSocket: FakeSocket;
vi.mock('../../lib/socket', () => ({ getSocket: () => fakeSocket }));
vi.mock('../api', () => ({
  adminApi: { listPhotos: vi.fn(), hidePhoto: vi.fn(), deletePhoto: vi.fn() },
}));
import { adminApi } from '../api';

const event: EventDetail = {
  id: 'e1', code: 'ABCD', name: 'Sara', createdAt: '2026-06-01T12:00:00.000Z',
  isActive: true, uploadEnabled: true, status: 'active', themeId: 'preset-midnight-gala',
  photoCount: 2, motionConfig: DEFAULT_MOTION_CONFIG,
};
function mkPhoto(id: string, createdAt: string, name = 'Guest'): PhotoAdmin {
  return {
    id, eventId: 'e1', uploaderName: name, mediaType: 'image', width: 800, height: 600,
    durationMs: null, createdAt, isHidden: false,
    displayUrl: `/media/display/${id}.jpg`, thumbUrl: `/media/thumb/${id}.jpg`,
    deviceId: `dev-${id}`, userAgent: 'UA', ipAddress: '1.2.3.4',
  };
}
const older = mkPhoto('p1', '2026-06-01T10:00:00.000Z', 'Alice');
const newer = mkPhoto('p2', '2026-06-01T11:00:00.000Z', 'Bob');

describe('AlbumTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSocket = createFakeSocket();
    (adminApi.listPhotos as ReturnType<typeof vi.fn>).mockResolvedValue([newer, older]); // newest-first
    (adminApi.hidePhoto as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (adminApi.deletePhoto as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('renders grid newest-first and joins room', async () => {
    renderWithProviders(<AlbumTab event={event} />);
    await screen.findByText('Bob');
    const tiles = screen.getAllByTestId('photo-tile');
    expect(tiles[0]).toHaveAttribute('data-photo-id', 'p2');
    expect(tiles[1]).toHaveAttribute('data-photo-id', 'p1');
    expect(fakeSocket.emitted).toContainEqual(['join', 'ABCD']);
  });

  it('shows admin-only device info', async () => {
    renderWithProviders(<AlbumTab event={event} />);
    await screen.findByText('Bob');
    const tile = screen.getByTestId('photo-tile-p2');
    await userEvent.click(within(tile).getByRole('button', { name: /info/i }));
    expect(within(tile).getByText(/dev-p2/)).toBeInTheDocument();
    expect(within(tile).getByText(/1\.2\.3\.4/)).toBeInTheDocument();
  });

  it('photo:added prepends new tile', async () => {
    renderWithProviders(<AlbumTab event={event} />);
    await screen.findByText('Bob');
    const incoming: Photo = {
      id: 'p3', eventId: 'e1', uploaderName: 'Cara', mediaType: 'image', width: 1, height: 1,
      durationMs: null, createdAt: '2026-06-01T12:30:00.000Z', isHidden: false,
      displayUrl: '/media/display/p3.jpg', thumbUrl: '/media/thumb/p3.jpg',
    };
    act(() => {
      fakeSocket.emitServer('photo:added', incoming);
    });
    await screen.findByText('Cara');
    const tiles = screen.getAllByTestId('photo-tile');
    expect(tiles[0]).toHaveAttribute('data-photo-id', 'p3');
  });

  it('hide calls api and marks tile hidden', async () => {
    renderWithProviders(<AlbumTab event={event} />);
    await screen.findByText('Bob');
    const tile = screen.getByTestId('photo-tile-p2');
    await userEvent.click(within(tile).getByRole('button', { name: /^hide$/i }));
    await waitFor(() => expect(adminApi.hidePhoto).toHaveBeenCalledWith('p2', true));
  });

  it('photo:deleted removes tile', async () => {
    renderWithProviders(<AlbumTab event={event} />);
    await screen.findByText('Bob');
    act(() => {
      fakeSocket.emitServer('photo:deleted', { id: 'p1' });
    });
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
  });

  it('photo:hidden marks tile hidden', async () => {
    renderWithProviders(<AlbumTab event={event} />);
    await screen.findByText('Bob');
    act(() => {
      fakeSocket.emitServer('photo:hidden', { id: 'p2' });
    });
    // default filter hides it from the visible grid
    await waitFor(() => expect(screen.queryByTestId('photo-tile-p2')).not.toBeInTheDocument());
    // with show-hidden on it reappears, marked hidden
    await userEvent.click(screen.getByRole('checkbox', { name: /show hidden/i }));
    const tile = await screen.findByTestId('photo-tile-p2');
    expect(within(tile).getByText('Hidden')).toBeInTheDocument();
  });

  it('bulk delete confirms and deletes selected', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<AlbumTab event={event} />);
    await screen.findByText('Bob');
    await userEvent.click(within(screen.getByTestId('photo-tile-p1')).getByRole('checkbox'));
    await userEvent.click(within(screen.getByTestId('photo-tile-p2')).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
    await waitFor(() => expect(adminApi.deletePhoto).toHaveBeenCalledWith('p1'));
    expect(adminApi.deletePhoto).toHaveBeenCalledWith('p2');
  });

  it('bulk hide hides selected', async () => {
    renderWithProviders(<AlbumTab event={event} />);
    await screen.findByText('Bob');
    await userEvent.click(within(screen.getByTestId('photo-tile-p1')).getByRole('checkbox'));
    await userEvent.click(within(screen.getByTestId('photo-tile-p2')).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /hide selected/i }));
    await waitFor(() => expect(adminApi.hidePhoto).toHaveBeenCalledWith('p1', true));
    expect(adminApi.hidePhoto).toHaveBeenCalledWith('p2', true);
  });

  it('show-hidden filter toggles visibility of hidden tiles', async () => {
    const hidden = { ...older, isHidden: true };
    (adminApi.listPhotos as ReturnType<typeof vi.fn>).mockResolvedValue([newer, hidden]);
    renderWithProviders(<AlbumTab event={event} />);
    await screen.findByText('Bob');
    // default hides the hidden tile
    expect(screen.queryByTestId('photo-tile-p1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /show hidden/i }));
    expect(screen.getByTestId('photo-tile-p1')).toBeInTheDocument();
  });
});
