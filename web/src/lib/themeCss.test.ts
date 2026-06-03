import { describe, it, expect } from 'vitest';
import type { ThemeTokens } from '../api/types';
import { themeToCssVars, themeVars, backgroundStyle, frameStyle } from './themeCss';

function tokens(overrides: Partial<ThemeTokens> = {}): ThemeTokens {
  return {
    background: { type: 'solid', value: '#10131c' },
    ambient: 'none',
    frame: { style: 'polaroid', borderColor: '#ffffff', borderWidth: 6, radius: 4, shadow: true },
    caption: { enabled: true, bg: 'rgba(0,0,0,0.6)', color: '#fff' },
    font: 'Inter, sans-serif',
    accent: '#c9a227',
    ...overrides,
  };
}

describe('themeToCssVars', () => {
  it('maps accent, font, frame, and caption tokens to CSS custom properties', () => {
    const vars = themeToCssVars(tokens()) as Record<string, string>;
    expect(vars['--rtpa-accent']).toBe('#c9a227');
    expect(vars['--rtpa-font']).toBe('Inter, sans-serif');
    expect(vars['--rtpa-frame-border-color']).toBe('#ffffff');
    expect(vars['--rtpa-frame-border-width']).toBe('6px');
    expect(vars['--rtpa-frame-radius']).toBe('4px');
    expect(vars['--rtpa-frame-shadow']).toBe('0 6px 24px rgba(0,0,0,0.35)');
    expect(vars['--rtpa-caption-bg']).toBe('rgba(0,0,0,0.6)');
    expect(vars['--rtpa-caption-color']).toBe('#fff');
  });

  it('emits no shadow when frame.shadow is false', () => {
    const vars = themeToCssVars(tokens({ frame: { style: 'thin', borderColor: '#000', borderWidth: 1, radius: 2, shadow: false } })) as Record<string, string>;
    expect(vars['--rtpa-frame-shadow']).toBe('none');
  });
});

describe('backgroundStyle', () => {
  it('solid background sets backgroundColor', () => {
    const style = backgroundStyle(tokens({ background: { type: 'solid', value: '#222' } }));
    expect(style.background).toBe('#222');
  });

  it('gradient background uses the raw value as background', () => {
    const value = 'linear-gradient(135deg, #1a2a6c, #b21f1f)';
    const style = backgroundStyle(tokens({ background: { type: 'gradient', value } }));
    expect(style.background).toBe(value);
  });

  it('image background sets a cover background-image url', () => {
    const style = backgroundStyle(tokens({ background: { type: 'image', value: '/media/bg.jpg' } }));
    expect(style.backgroundImage).toBe('url("/media/bg.jpg")');
    expect(style.backgroundSize).toBe('cover');
    expect(style.backgroundPosition).toBe('center');
  });
});

// `themeVars` is the name the admin console (Plan 5) imports; it is an alias of
// `themeToCssVars`. `frameStyle` returns a concrete tile-frame style object (used by
// the theme-builder live preview in Plan 5 and the display Tile in Plan 6).
describe('themeVars (alias) and frameStyle', () => {
  it('themeVars is identical to themeToCssVars', () => {
    expect(themeVars(tokens())).toEqual(themeToCssVars(tokens()));
  });

  it('frameStyle maps border tokens to a concrete style', () => {
    const style = frameStyle(tokens({ frame: { style: 'thin', borderColor: '#abcdef', borderWidth: 3, radius: 8, shadow: false } }));
    expect(style.borderColor).toBe('#abcdef');
    expect(style.borderWidth).toBe(3);
    expect(style.borderRadius).toBe(8);
    expect(style.boxShadow).toBe('none');
  });

  it('frameStyle "none" removes border and shadow', () => {
    const style = frameStyle(tokens({ frame: { style: 'none', borderColor: '#000', borderWidth: 0, radius: 0, shadow: false } }));
    expect(style.border).toBe('none');
    expect(style.boxShadow).toBe('none');
  });

  it('frameStyle "polaroid" thickens the bottom border', () => {
    const style = frameStyle(tokens({ frame: { style: 'polaroid', borderColor: '#fff', borderWidth: 6, radius: 4, shadow: true } }));
    expect(style.borderBottomWidth).toBe(16);
  });
});
