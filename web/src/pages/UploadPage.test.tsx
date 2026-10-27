import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { PublicEvent, Photo } from '../api/types';

// Mock the request functions but keep the real ApiError class so `instanceof`
// and the parsed `.code`/`.status` fields behave as in production.
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getPublicEvent: vi.fn(),
    getPublicPhotos: vi.fn(),
    uploadFiles: vi.fn(),
  };
});
const fakeSocket = {
  handlers: {} as Record<string, (...args: any[]) => void>,
  emit: vi.fn(),
  on(ev: string, cb: (...args: any[]) => void) {
    this.handlers[ev] = cb;
  },
  off: vi.fn(),
};
vi.mock('../lib/socket', async (importActual) => ({
  ...(await importActual<typeof import('../lib/socket')>()),
  connectSocket: () => fakeSocket,
  getSocket: () => fakeSocket,
}));
vi.mock('../lib/deviceId', () => ({ getDeviceId: () => 'dev-test', DEVICE_ID_KEY: 'rtpa_device_id' }));
vi.mock('../lib/downscaleImage', () => ({ downscaleImage: vi.fn(async (f: File) => f) }));
// jsdom can't decode video metadata; default to "unknown duration".
vi.mock('../lib/videoDuration', () => ({ readVideoDurationSec: vi.fn(async () => null) }));
import { readVideoDurationSec } from '../lib/videoDuration';

import { getPublicEvent, uploadFiles, ApiError } from '../api/client';
import UploadPage from './UploadPage';

const baseEvent: PublicEvent = {
  code: 'PARTY1',
  name: 'Sam & Lee',
  status: 'active',
  uploadEnabled: true,
  theme: {
    id: 'preset-midnight-gala',
    name: 'Midnight Gala',
    isPreset: true,
    tokens: {
      background: { type: 'solid', value: '#10131c' },
      ambient: 'none',
      frame: { style: 'thin', borderColor: '#fff', borderWidth: 2, radius: 8, shadow: true },
      caption: { enabled: true, bg: '#000', color: '#fff' },
      font: 'Inter, sans-serif',
      accent: '#c9a227',
    },
  },
  motionConfig: {
    motionWeights: { drift: 5, current: 2, orbit: 1, mosaic: 2, sway: 0, bob: 0, breathe: 0 },
    speed: 1,
    maxOnCanvas: 24,
    dwell: { enabled: true, durationMs: 45000, varianceMs: 15000 },
    enterWeights: { flyInEdge: 3, scalePop: 2, fadeGrow: 2, spinIn: 1, dropBounce: 2 },
    leaveWeights: { driftOffEdge: 3, shrinkFade: 3, spinOut: 1, slideAway: 2 },
    baseSize: 220,
    sizeVariance: 0.4,
    tiltMinDeg: -8,
    tiltMaxDeg: 8,
  },
  mediaLimits: { photoMaxBytes: 25 * 1024 * 1024, videoMaxBytes: 60 * 1024 * 1024, videoMaxDurationSec: 30 },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/e/PARTY1']}>
        <Routes>
          <Route path="/e/:code" element={<UploadPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fakeSocket.handlers = {};
  localStorage.clear();
  vi.clearAllMocks();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('UploadPage', () => {
  it('renders the event name and the be-responsible note', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    renderPage();
    expect(await screen.findByText('Sam & Lee')).toBeInTheDocument();
    expect(screen.getByText(/be responsible/i)).toBeInTheDocument();
  });

  it('shows the closed state when uploadEnabled is false', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue({ ...baseEvent, uploadEnabled: false });
    renderPage();
    expect(await screen.findByText(/uploads are closed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/add photos/i)).not.toBeInTheDocument();
  });

  it('shows the closed state when status is ended', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue({ ...baseEvent, status: 'ended' });
    renderPage();
    expect(await screen.findByText(/uploads are closed/i)).toBeInTheDocument();
  });

  it('shows a not-found state on 404', async () => {
    vi.mocked(getPublicEvent).mockRejectedValue(new ApiError(404, '{"error":"not_found"}'));
    renderPage();
    expect(await screen.findByText(/can.?t find that party/i)).toBeInTheDocument();
  });

  it('persists the typed name to localStorage', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    renderPage();
    const input = await screen.findByLabelText(/your name/i);
    await userEvent.type(input, 'Robin');
    expect(localStorage.getItem('rtpa_uploader_name')).toBe('Robin');
  });

  it('uploads selected files with deviceId + name and renders progress then success', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    const photo: Photo = {
      id: 'p1',
      eventId: 'e1',
      uploaderName: 'Robin',
      mediaType: 'image',
      width: 1600,
      height: 1200,
      durationMs: null,
      createdAt: new Date().toISOString(),
      isHidden: false,
      isPriority: false,
      displayUrl: '/media/display/p1.jpg',
      thumbUrl: '/media/thumb/p1.jpg',
    };
    vi.mocked(uploadFiles).mockImplementation(async (_code, args) => {
      args.onProgress?.(0.5);
      args.onProgress?.(1);
      return [photo];
    });

    renderPage();
    const input = await screen.findByLabelText(/your name/i);
    await userEvent.type(input, '  Robin  ');

    const file = new File(['x'], 'pic.jpg', { type: 'image/jpeg' });
    const picker = screen.getByLabelText(/add photos/i) as HTMLInputElement;
    await userEvent.upload(picker, file);

    await waitFor(() => expect(uploadFiles).toHaveBeenCalledTimes(1));
    const callArgs = vi.mocked(uploadFiles).mock.calls[0];
    expect(callArgs[0]).toBe('PARTY1');
    expect(callArgs[1].uploaderName).toBe('Robin');
    expect(callArgs[1].deviceId).toBe('dev-test');
    expect(callArgs[1].files).toHaveLength(1);

    expect(await screen.findByText(/added to the party/i)).toBeInTheDocument();
    expect(screen.getByTestId('contribution-strip').querySelectorAll('img')).toHaveLength(1);
  });

  it('shows a rejection toast for unsupported files and does not upload them', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    renderPage();
    await screen.findByLabelText(/your name/i);

    const bad = new File(['x'], 'note.txt', { type: 'text/plain' });
    const picker = screen.getByLabelText(/add photos/i) as HTMLInputElement;
    // applyAccept:false so the unsupported file reaches our handler (some
    // mobile pickers let users bypass the `accept` filter); we reject it
    // client-side via validateFiles.
    await userEvent.upload(picker, bad, { applyAccept: false });

    expect(await screen.findByRole('alert')).toHaveTextContent(/note\.txt/i);
    expect(uploadFiles).not.toHaveBeenCalled();

    // Re-picking the same unsupported file replaces (does not pile up) the toast.
    await userEvent.upload(picker, bad, { applyAccept: false });
    await waitFor(() =>
      expect(screen.getAllByText(/note\.txt/i)).toHaveLength(1),
    );
  });

  it('maps a too-many-uploads error to a friendly slow-down message', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    vi.mocked(uploadFiles).mockRejectedValue(new ApiError(429, '{"error":"too_many_uploads"}'));

    renderPage();
    const input = await screen.findByLabelText(/your name/i);
    await userEvent.type(input, 'Robin');

    const file = new File(['x'], 'pic.jpg', { type: 'image/jpeg' });
    const picker = screen.getByLabelText(/add photos/i) as HTMLInputElement;
    await userEvent.upload(picker, file);

    expect(await screen.findByText(/slow down a moment/i)).toBeInTheDocument();
  });

  it('blocks upload until a name is entered', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    renderPage();
    await screen.findByLabelText(/your name/i);

    const file = new File(['x'], 'pic.jpg', { type: 'image/jpeg' });
    const picker = screen.getByLabelText(/add photos/i) as HTMLInputElement;
    await userEvent.upload(picker, file);

    expect(await screen.findByText(/add your name/i)).toBeInTheDocument();
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it('disables the file input while an upload is in flight (double-submit guard)', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    let resolveUpload: (photos: Photo[]) => void = () => {};
    vi.mocked(uploadFiles).mockImplementation(
      () => new Promise<Photo[]>((resolve) => { resolveUpload = resolve; }),
    );

    renderPage();
    const input = await screen.findByLabelText(/your name/i);
    await userEvent.type(input, 'Robin');

    const file = new File(['x'], 'pic.jpg', { type: 'image/jpeg' });
    const picker = screen.getByLabelText(/add photos/i) as HTMLInputElement;
    await userEvent.upload(picker, file);

    await waitFor(() => expect(uploadFiles).toHaveBeenCalledTimes(1));
    // While the upload promise is pending the picker is disabled.
    await waitFor(() => expect(picker).toBeDisabled());

    resolveUpload([]);
    await waitFor(() => expect(picker).not.toBeDisabled());
  });

  it("validates against the host's configured limits, not the built-in defaults", async () => {
    vi.mocked(getPublicEvent).mockResolvedValue({
      ...baseEvent,
      mediaLimits: { photoMaxBytes: 1024 * 1024, videoMaxBytes: 60 * 1024 * 1024, videoMaxDurationSec: 30 },
    });
    renderPage();
    const input = await screen.findByLabelText(/your name/i);
    await userEvent.type(input, 'Robin');

    // 2 MB: under the 25 MB default, over this host's 1 MB cap.
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText(/add photos/i), big);

    expect(await screen.findByRole('alert')).toHaveTextContent(/big\.jpg is too large \(max 1 MB\)/);
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it('tells the guest a long video will be trimmed, and still uploads it', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    vi.mocked(readVideoDurationSec).mockResolvedValueOnce(95);
    vi.mocked(uploadFiles).mockResolvedValue([]);
    renderPage();
    const input = await screen.findByLabelText(/your name/i);
    await userEvent.type(input, 'Robin');

    const clip = new File(['x'], 'toast.mov', { type: 'video/quicktime' });
    await userEvent.upload(screen.getByLabelText(/add photos/i), clip);

    expect(await screen.findByText(/toast\.mov is longer than 30s/)).toBeInTheDocument();
    await waitFor(() => expect(uploadFiles).toHaveBeenCalledTimes(1));
  });

  it('switches to the closed state live when the host pauses uploads', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    renderPage();
    await screen.findByLabelText(/add photos/i);
    expect(fakeSocket.emit).toHaveBeenCalledWith('join', 'PARTY1');

    act(() => {
      fakeSocket.handlers['event:updated']({ ...baseEvent, uploadEnabled: false });
    });
    expect(await screen.findByText(/uploads are closed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/add photos/i)).not.toBeInTheDocument();

    act(() => {
      fakeSocket.handlers['event:updated']({ ...baseEvent, uploadEnabled: true });
    });
    expect(await screen.findByLabelText(/add photos/i)).toBeInTheDocument();
  });
});
