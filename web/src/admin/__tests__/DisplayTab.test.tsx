import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisplayTab } from '../event/DisplayTab';
import { renderWithProviders } from './helpers/renderWithProviders';
import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';
import type { EventDetail } from '@rtpa/shared';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ApiError: actual.ApiError,
    adminApi: { setMotion: vi.fn(), setEventTheme: vi.fn(), listThemes: vi.fn().mockResolvedValue([]) },
  };
});
import { adminApi, ApiError } from '../api';

const event: EventDetail = {
  id: 'e1',
  code: 'ABCD',
  name: 'Sara',
  createdAt: '2026-06-01T12:00:00.000Z',
  isActive: true,
  uploadEnabled: true,
  status: 'active',
  themeId: 'preset-midnight-gala',
  photoCount: 0,
  motionConfig: DEFAULT_MOTION_CONFIG,
};

describe('DisplayTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // shouldAdvanceTime lets testing-library's waitFor poll under fake timers
    // while vi.advanceTimersByTime still drives the debounce timer explicitly.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    (adminApi.setMotion as ReturnType<typeof vi.fn>).mockResolvedValue(event);
  });
  afterEach(() => vi.useRealTimers());

  it('changing speed issues debounced PUT with updated MotionConfig', async () => {
    renderWithProviders(<DisplayTab event={event} />);
    const speed = screen.getByLabelText(/overall speed/i) as HTMLInputElement;
    fireEvent.change(speed, { target: { value: '2' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await waitFor(() => expect(adminApi.setMotion).toHaveBeenCalledTimes(1));
    const [id, cfg] = (adminApi.setMotion as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('e1');
    expect(cfg.speed).toBe(2);
    expect(cfg.maxOnCanvas).toBe(DEFAULT_MOTION_CONFIG.maxOnCanvas);
  });

  it('changing maxOnCanvas PUTs updated cap', async () => {
    renderWithProviders(<DisplayTab event={event} />);
    const max = screen.getByLabelText(/max on canvas/i) as HTMLInputElement;
    fireEvent.change(max, { target: { value: '30' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await waitFor(() => expect(adminApi.setMotion).toHaveBeenCalled());
    const cfg = (adminApi.setMotion as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(cfg.maxOnCanvas).toBe(30);
  });

  it('dwell toggle updates dwell.enabled', async () => {
    renderWithProviders(<DisplayTab event={event} />);
    const toggle = screen.getByLabelText(/dwell timeout enabled/i);
    fireEvent.click(toggle);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await waitFor(() => expect(adminApi.setMotion).toHaveBeenCalled());
    const cfg = (adminApi.setMotion as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(cfg.dwell.enabled).toBe(false);
  });

  it('surfaces a save-error when setMotion rejects and clears the saving indicator', async () => {
    (adminApi.setMotion as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError(400, '{"error":"bad"}'),
    );
    renderWithProviders(<DisplayTab event={event} />);
    const speed = screen.getByLabelText(/overall speed/i) as HTMLInputElement;
    fireEvent.change(speed, { target: { value: '2' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/save failed \(400\)/i);
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });

  it('open display opens /e/:code/display', async () => {
    vi.useRealTimers();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderWithProviders(<DisplayTab event={event} />);
    await userEvent.click(screen.getByRole('button', { name: /open display/i }));
    expect(openSpy).toHaveBeenCalledWith('/e/ABCD/display', '_blank', 'noopener');
  });
});
