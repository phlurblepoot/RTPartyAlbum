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

  it('renders a rotated, positioned bubble', () => {
    renderCap({
      ...baseCaption,
      position: 'bubble',
      bubble: { ...DEFAULT_BUBBLE, xPct: 70, yPct: 20, rotation: 15, radius: 10, borderWidth: 3, borderColor: '#f0f' },
    });
    const el = screen.getByTestId('tile-caption');
    expect(el).toHaveAttribute('data-caption-position', 'bubble');
    expect(el.style.left).toBe('70%');
    expect(el.style.top).toBe('20%');
    expect(el.style.transform).toContain('rotate(15deg)');
    expect(el.style.borderRadius).toBe('10px');
  });
});
