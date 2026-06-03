import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemesPage } from '../ThemesPage';
import { renderWithProviders } from './helpers/renderWithProviders';
import type { Theme, ThemeTokens } from '@rtpa/shared';

vi.mock('../api', () => ({
  adminApi: { listThemes: vi.fn(), createTheme: vi.fn(), deleteTheme: vi.fn(), updateTheme: vi.fn() },
}));
import { adminApi } from '../api';

const tokens: ThemeTokens = {
  background: { type: 'solid', value: '#101018' }, ambient: 'glow',
  frame: { style: 'thin', borderColor: '#fff', borderWidth: 2, radius: 8, shadow: true },
  caption: { enabled: true, bg: '#000', color: '#fff' }, font: 'Inter', accent: '#e0b3ff',
};
const preset: Theme = { id: 'preset-neon-night', name: 'Neon Night', isPreset: true, tokens };
const custom: Theme = { id: 't1', name: 'Mine', isPreset: false, tokens };

describe('ThemesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminApi.listThemes as ReturnType<typeof vi.fn>).mockResolvedValue([preset, custom]);
    (adminApi.createTheme as ReturnType<typeof vi.fn>).mockResolvedValue({ ...custom, id: 't2', name: 'Neon Night (copy)' });
    (adminApi.deleteTheme as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('lists presets and custom themes', async () => {
    renderWithProviders(<ThemesPage />);
    expect(await screen.findByText('Neon Night')).toBeInTheDocument();
    expect(screen.getByText('Mine')).toBeInTheDocument();
  });

  it('surfaces a load error when listThemes fails', async () => {
    (adminApi.listThemes as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('401'));
    renderWithProviders(<ThemesPage />);
    expect(await screen.findByText(/failed to load themes/i)).toBeInTheDocument();
  });

  it('delete is disabled for presets', async () => {
    renderWithProviders(<ThemesPage />);
    await screen.findByText('Neon Night');
    const row = screen.getByTestId('theme-row-preset-neon-night');
    expect(row.querySelector('button[data-action="delete"]')).toBeDisabled();
  });

  it('duplicate a preset calls createTheme from its tokens', async () => {
    renderWithProviders(<ThemesPage />);
    await screen.findByText('Neon Night');
    const row = screen.getByTestId('theme-row-preset-neon-night');
    await userEvent.click(row.querySelector('button[data-action="duplicate"]')!);
    await waitFor(() => expect(adminApi.createTheme).toHaveBeenCalledWith('Neon Night (copy)', tokens));
  });

  it('delete custom calls deleteTheme', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<ThemesPage />);
    await screen.findByText('Mine');
    const row = screen.getByTestId('theme-row-t1');
    await userEvent.click(row.querySelector('button[data-action="delete"]')!);
    await waitFor(() => expect(adminApi.deleteTheme).toHaveBeenCalledWith('t1'));
  });
});
