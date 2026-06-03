import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../SettingsPage';
import { renderWithProviders } from './helpers/renderWithProviders';
import { DEFAULT_MEDIA_LIMITS } from '@rtpa/shared';

vi.mock('../api', () => {
  const ApiError = class extends Error { status: number; constructor(s: number, m: string){ super(m); this.status = s; } };
  return {
    ApiError,
    adminApi: { getSettings: vi.fn(), saveSettings: vi.fn(), changePassword: vi.fn() },
  };
});
import { adminApi, ApiError } from '../api';

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminApi.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      publicBaseUrl: 'https://party.test', mediaLimits: DEFAULT_MEDIA_LIMITS,
    });
    (adminApi.saveSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
      publicBaseUrl: 'https://new.test', mediaLimits: DEFAULT_MEDIA_LIMITS,
    });
    (adminApi.changePassword as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('save settings PUTs updated publicBaseUrl and limits (MB converted to bytes)', async () => {
    renderWithProviders(<SettingsPage />);
    const base = await screen.findByLabelText(/public base url/i);
    fireEvent.change(base, { target: { value: 'https://new.test' } });
    // Input is now in MB — type "25" → should save 25 * 1024 * 1024 = 26214400 bytes
    fireEvent.change(screen.getByLabelText(/photo max \(mb\)/i), { target: { value: '25' } });
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(adminApi.saveSettings).toHaveBeenCalled());
    const arg = (adminApi.saveSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.publicBaseUrl).toBe('https://new.test');
    expect(arg.mediaLimits.photoMaxBytes).toBe(26214400);
  });

  it('password mismatch blocks submit and shows message', async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByLabelText(/public base url/i);
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'b' } });
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(adminApi.changePassword).not.toHaveBeenCalled();
  });

  it('wrong current password shows 401 error', async () => {
    (adminApi.changePassword as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'bad'));
    renderWithProviders(<SettingsPage />);
    await screen.findByLabelText(/public base url/i);
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'abc' } });
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
  });
});
