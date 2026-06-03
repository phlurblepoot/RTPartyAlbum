import type { ThemeTokens } from '@rtpa/shared';

/** A deterministic preset ThemeTokens for use in display tests. */
export const PRESET_THEME_TOKENS: ThemeTokens = {
  background: { type: 'gradient', value: 'linear-gradient(135deg, #0b1026 0%, #1c2240 60%, #2a1a3e 100%)' },
  ambient: 'glow',
  frame: { style: 'thin', borderColor: '#d4af37', borderWidth: 2, radius: 10, shadow: true },
  caption: { enabled: true, bg: 'rgba(10,12,30,0.72)', color: '#f5e9c8' },
  font: "'Playfair Display', Georgia, serif",
  accent: '#d4af37',
};
