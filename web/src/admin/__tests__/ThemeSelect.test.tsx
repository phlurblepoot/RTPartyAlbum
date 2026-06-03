import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeSelect } from '../event/ThemeSelect';
import { renderWithProviders } from './helpers/renderWithProviders';
import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';
import type { EventDetail, Theme, ThemeTokens } from '@rtpa/shared';

vi.mock('../api', () => ({ adminApi: { listThemes: vi.fn(), setEventTheme: vi.fn() } }));
import { adminApi } from '../api';

const tokens: ThemeTokens = {
  background: { type: 'solid', value: '#101018' }, ambient: 'glow',
  frame: { style: 'thin', borderColor: '#fff', borderWidth: 2, radius: 8, shadow: true },
  caption: { enabled: true, bg: '#000', color: '#fff' }, font: 'Inter', accent: '#e0b3ff',
};
const preset: Theme = { id: 'preset-neon-night', name: 'Neon Night', isPreset: true, tokens };
const custom: Theme = { id: 't1', name: 'Mine', isPreset: false, tokens };

const event: EventDetail = {
  id: 'e1',
  code: 'ABCD',
  name: 'Sara',
  createdAt: '2026-06-01T12:00:00.000Z',
  isActive: true,
  uploadEnabled: true,
  status: 'active',
  themeId: 'preset-neon-night',
  photoCount: 0,
  motionConfig: DEFAULT_MOTION_CONFIG,
};

describe('ThemeSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminApi.listThemes as ReturnType<typeof vi.fn>).mockResolvedValue([preset, custom]);
    (adminApi.setEventTheme as ReturnType<typeof vi.fn>).mockResolvedValue({ ...event, themeId: 't1' });
  });

  it('selecting a theme calls setEventTheme and updates the event cache', async () => {
    const { client } = renderWithProviders(<ThemeSelect event={event} />);
    await screen.findByRole('option', { name: /mine/i });
    await userEvent.selectOptions(screen.getByLabelText(/event theme/i), 't1');
    await waitFor(() => expect(adminApi.setEventTheme).toHaveBeenCalledWith('e1', 't1'));
    await waitFor(() =>
      expect(
        (client.getQueryData(['admin', 'event', 'e1']) as EventDetail | undefined)?.themeId,
      ).toBe('t1'),
    );
  });
});
