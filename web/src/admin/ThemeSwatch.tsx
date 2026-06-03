import type { CSSProperties } from 'react';
import type { ThemeTokens } from '@rtpa/shared';
import { backgroundStyle, frameStyle } from '../lib/themeCss';

/**
 * A small, dependency-free visual preview of a theme: the theme background with
 * a few framed "photos" (plain colored rectangles, so there are no external
 * image requests or broken-image icons) and, when enabled, caption bars. It
 * reuses the SAME `backgroundStyle`/`frameStyle` helpers the live display uses,
 * so what an admin sees here matches the canvas (WYSIWYG).
 */
const SAMPLE_COLORS = ['#cdd9e3', '#f1ccd0', '#d2e6cf'];

export function ThemeSwatch({ tokens }: { tokens: ThemeTokens }) {
  const bg = backgroundStyle(tokens) as CSSProperties;
  return (
    <div className="theme-swatch" style={{ ...bg, fontFamily: tokens.font }} aria-hidden="true">
      {SAMPLE_COLORS.map((color, i) => (
        <div
          key={color}
          className="theme-swatch__tile"
          style={{ ...frameStyle(tokens), transform: `rotate(${(i - 1) * 4}deg)` }}
        >
          <div className="theme-swatch__photo" style={{ background: color }} />
          {tokens.caption.enabled && (
            <div
              className="theme-swatch__caption"
              style={{ background: tokens.caption.bg, color: tokens.caption.color }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
