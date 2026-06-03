import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeEditor } from '../ThemeEditor';
import { renderWithProviders } from './helpers/renderWithProviders';
import type { Theme, ThemeTokens } from '@rtpa/shared';

vi.mock('../api', () => ({ adminApi: { updateTheme: vi.fn(), createTheme: vi.fn() } }));
import { adminApi } from '../api';

const tokens: ThemeTokens = {
  background: { type: 'solid', value: '#101018' },
  ambient: 'glow',
  frame: { style: 'thin', borderColor: '#ffffff', borderWidth: 2, radius: 8, shadow: true },
  caption: { enabled: true, bg: '#000000', color: '#ffffff' },
  font: 'Inter', accent: '#e0b3ff',
};
const custom: Theme = { id: 't-custom', name: 'My Theme', isPreset: false, tokens };
const preset: Theme = { id: 'preset-neon-night', name: 'Neon Night', isPreset: true, tokens };

describe('ThemeEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminApi.updateTheme as ReturnType<typeof vi.fn>).mockResolvedValue(custom);
  });

  it('editing accent updates the live preview', async () => {
    renderWithProviders(<ThemeEditor theme={custom} onSaved={vi.fn()} />);
    const accent = screen.getByLabelText(/accent/i) as HTMLInputElement;
    fireEvent.change(accent, { target: { value: '#00ff00' } });
    const preview = screen.getByTestId('theme-preview');
    await waitFor(() =>
      expect(preview.style.getPropertyValue('--rtpa-accent')).toBe('#00ff00'),
    );
  });

  it('save on custom calls updateTheme with tokens', async () => {
    const onSaved = vi.fn();
    renderWithProviders(<ThemeEditor theme={custom} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/border width/i), { target: { value: '6' } });
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(adminApi.updateTheme).toHaveBeenCalled());
    const [id, input] = (adminApi.updateTheme as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('t-custom');
    expect(input.tokens.frame.borderWidth).toBe(6);
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows alignment for bar captions and reveals bubble controls for the bubble position', async () => {
    renderWithProviders(<ThemeEditor theme={custom} onSaved={vi.fn()} />);
    // Default (below) -> alignment visible, bubble controls hidden.
    expect(screen.getByLabelText(/caption alignment/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/bubble rotation/i)).not.toBeInTheDocument();
    // Switch to bubble -> bubble controls appear, alignment goes away.
    fireEvent.change(screen.getByLabelText(/caption position/i), { target: { value: 'bubble' } });
    expect(await screen.findByLabelText(/bubble rotation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bubble x/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/caption alignment/i)).not.toBeInTheDocument();
  });

  it('preset shows Duplicate instead of Save, no Delete', () => {
    renderWithProviders(<ThemeEditor theme={preset} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: /duplicate/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
  });
});
