import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Backdrop } from '../Backdrop';
import { PRESET_THEME_TOKENS } from '../renderer/__tests__/testTheme';

// Note: the plan defined a local backgroundStyle returning { backgroundColor } for solid,
// but we reuse backgroundStyle from themeCss.ts (which returns { background: value } for
// solid/gradient) for WYSIWYG parity with the admin preview. Tests adapted accordingly.

describe('Backdrop', () => {
  it('applies a solid background color via the background shorthand', () => {
    const theme = {
      ...PRESET_THEME_TOKENS,
      background: { type: 'solid' as const, value: '#0b1020' },
    };
    const { container } = render(<Backdrop theme={theme} />);
    const bg = container.querySelector('[data-testid="backdrop"]') as HTMLElement;
    // themeCss.backgroundStyle returns { background: value } for solid
    // JSDOM normalizes hex colors to rgb() form
    expect(bg.style.background).toBe('rgb(11, 16, 32)');
  });

  it('applies a gradient as background shorthand', () => {
    const theme = {
      ...PRESET_THEME_TOKENS,
      background: { type: 'gradient' as const, value: 'linear-gradient(180deg,#000,#111)' },
    };
    const { container } = render(<Backdrop theme={theme} />);
    const bg = container.querySelector('[data-testid="backdrop"]') as HTMLElement;
    // themeCss.backgroundStyle returns { background: value } for gradient
    expect(bg.style.background).toContain('linear-gradient');
  });

  it('applies an image url for image backgrounds', () => {
    const theme = {
      ...PRESET_THEME_TOKENS,
      background: { type: 'image' as const, value: 'https://x/y.jpg' },
    };
    const { container } = render(<Backdrop theme={theme} />);
    const bg = container.querySelector('[data-testid="backdrop"]') as HTMLElement;
    expect(bg.style.backgroundImage).toContain('url(');
  });

  it('renders an ambient layer with the ambient class', () => {
    const theme = { ...PRESET_THEME_TOKENS, ambient: 'bokeh' as const };
    const { container } = render(<Backdrop theme={theme} />);
    expect(container.querySelector('.ambient-bokeh')).not.toBeNull();
  });

  it('renders no ambient effect for ambient=none', () => {
    const theme = { ...PRESET_THEME_TOKENS, ambient: 'none' as const };
    const { container } = render(<Backdrop theme={theme} />);
    expect(container.querySelector('.ambient-none')).not.toBeNull();
    // none class should be present; it will have opacity: 0 via CSS
  });

  it('renders a glow ambient layer', () => {
    const theme = { ...PRESET_THEME_TOKENS, ambient: 'glow' as const };
    const { container } = render(<Backdrop theme={theme} />);
    expect(container.querySelector('.ambient-glow')).not.toBeNull();
  });

  it('renders a particles ambient layer', () => {
    const theme = { ...PRESET_THEME_TOKENS, ambient: 'particles' as const };
    const { container } = render(<Backdrop theme={theme} />);
    expect(container.querySelector('.ambient-particles')).not.toBeNull();
  });
});
