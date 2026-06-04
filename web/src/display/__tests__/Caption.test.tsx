import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Caption } from '../Caption';
import { resolveCaption, DEFAULT_BUBBLE } from '../../lib/caption';
import type { ThemeTokens } from '@rtpa/shared';

const baseCaption: ThemeTokens['caption'] = { enabled: true, bg: '#000', color: '#fff' };

describe('resolveCaption', () => {
  it('fills defaults for missing layout fields (old themes -> below/left)', () => {
    const r = resolveCaption(baseCaption);
    expect(r.position).toBe('below');
    expect(r.align).toBe('left');
    expect(r.offsetPx).toBe(0);
    expect(r.insideEdge).toBe('bottom');
    expect(r.bubble).toEqual(DEFAULT_BUBBLE);
  });

  it('preserves explicitly-set fields and merges partial bubble', () => {
    const r = resolveCaption({
      ...baseCaption,
      position: 'bubble',
      align: 'right',
      offsetPx: 20,
      bubble: { ...DEFAULT_BUBBLE, rotation: 30 },
    });
    expect(r.position).toBe('bubble');
    expect(r.align).toBe('right');
    expect(r.offsetPx).toBe(20);
    expect(r.bubble.rotation).toBe(30);
  });
});

describe('Caption', () => {
  function renderCap(caption: ThemeTokens['caption']) {
    return render(<Caption caption={resolveCaption(caption)} font="Inter" name="Jordan" />);
  }

  it('renders the name in a below pill by default', () => {
    renderCap(baseCaption);
    const el = screen.getByTestId('tile-caption');
    expect(el).toHaveTextContent('Jordan');
    expect(el).toHaveAttribute('data-caption-position', 'below');
  });

  it('renders an inside band on the chosen edge', () => {
    renderCap({ ...baseCaption, position: 'inside', insideEdge: 'top' });
    const el = screen.getByTestId('tile-caption');
    expect(el).toHaveAttribute('data-caption-position', 'inside');
    expect(el.style.top).toBe('0px');
  });

  it('pins a rotated, fixed-size bubble to the chosen corner by px offset', () => {
    renderCap({
      ...baseCaption,
      position: 'bubble',
      bubble: { ...DEFAULT_BUBBLE, corner: 'bottom-left', offsetX: 12, offsetY: 8, width: 120, height: 44, rotation: 15, radius: 10 },
    });
    const el = screen.getByTestId('tile-caption');
    expect(el).toHaveAttribute('data-caption-position', 'bubble');
    // bottom-left -> pinned via bottom/left px offsets (constant distance from corner)
    expect(el.style.bottom).toBe('8px');
    expect(el.style.left).toBe('12px');
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('44px');
    expect(el.style.transform).toContain('rotate(15deg)');
    expect(el.style.borderRadius).toBe('10px');
  });
});
