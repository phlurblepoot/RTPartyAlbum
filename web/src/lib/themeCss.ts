import type { CSSProperties } from 'react';
import type { ThemeTokens } from '../api/types';

export function themeToCssVars(tokens: ThemeTokens): CSSProperties {
  const { frame, caption } = tokens;
  const vars: Record<string, string> = {
    '--rtpa-accent': tokens.accent,
    '--rtpa-font': tokens.font,
    '--rtpa-frame-style': frame.style,
    '--rtpa-frame-border-color': frame.borderColor,
    '--rtpa-frame-border-width': `${frame.borderWidth}px`,
    '--rtpa-frame-radius': `${frame.radius}px`,
    '--rtpa-frame-shadow': frame.shadow ? '0 6px 24px rgba(0,0,0,0.35)' : 'none',
    '--rtpa-caption-bg': caption.bg,
    '--rtpa-caption-color': caption.color,
  };
  return vars as CSSProperties;
}

export function backgroundStyle(tokens: ThemeTokens): CSSProperties {
  const { background } = tokens;
  if (background.type === 'image') {
    return {
      backgroundImage: `url("${background.value}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  // solid and gradient both map directly to the `background` shorthand
  return { background: background.value };
}

/**
 * Alias consumed by the admin console (Plan 5). Identical to `themeToCssVars` —
 * emits the theme's CSS custom properties (including `--rtpa-accent`).
 */
export const themeVars = themeToCssVars;

/**
 * Concrete frame style for a single tile/figure, derived from the theme's frame
 * tokens. Used by the Plan 5 theme-builder preview and the Plan 6 display Tile.
 */
export function frameStyle(tokens: ThemeTokens): CSSProperties {
  const { frame } = tokens;
  if (frame.style === 'none') {
    return { border: 'none', borderRadius: 0, boxShadow: 'none' };
  }
  const base: CSSProperties = {
    borderStyle: 'solid',
    borderColor: frame.borderColor,
    borderWidth: frame.borderWidth,
    borderRadius: frame.radius,
    boxShadow: frame.shadow ? '0 6px 24px rgba(0,0,0,0.35)' : 'none',
    background: '#fff',
  };
  if (frame.style === 'polaroid') {
    // Polaroid look: thick bottom edge, minimal corner rounding.
    return { ...base, borderBottomWidth: Math.max(frame.borderWidth, 16), borderRadius: 2 };
  }
  // 'thin' and 'rounded' are expressed purely through the borderWidth/radius tokens.
  return base;
}
