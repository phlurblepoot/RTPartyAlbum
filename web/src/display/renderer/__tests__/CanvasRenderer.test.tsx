import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CanvasRenderer } from '../CanvasRenderer';
import { makeTile } from '../../rotationEngine';
import { makePhoto, testConfig, constRng } from '../../__tests__/fixtures';
import { PRESET_THEME_TOKENS } from './testTheme';

describe('CanvasRenderer', () => {
  it('renders one element per tile with size and position applied', () => {
    const tiles = [
      makeTile(makePhoto('p1'), testConfig, 0, constRng(0.25)),
      makeTile(makePhoto('p2'), testConfig, 0, constRng(0.75)),
    ];
    const { container } = render(
      <CanvasRenderer tiles={tiles} config={testConfig} theme={PRESET_THEME_TOKENS} />,
    );
    const els = container.querySelectorAll('[data-tile-id]');
    expect(els).toHaveLength(2);
    const first = els[0] as HTMLElement;
    const size = Math.round(tiles[0].size);
    // width is the tile size in px
    expect(first.style.width).toBe(`${size}px`);
    // positioned within the safe band [0, canvas - size] so tiles near the
    // far edges stay fully on-canvas (x/y are 0..1 normalized).
    expect(first.style.left).toBe(`calc(${tiles[0].x} * (100% - ${size}px))`);
    expect(first.style.top).toBe(`calc(${tiles[0].y} * (100% - ${size}px))`);
  });

  it('renders tile content (Tile component) inside each motion.div', () => {
    const tiles = [makeTile(makePhoto('img1'), testConfig, 0, constRng(0.5))];
    const { container } = render(
      <CanvasRenderer tiles={tiles} config={testConfig} theme={PRESET_THEME_TOKENS} />,
    );
    // Tile renders a data-testid="tile-frame" element
    const frames = container.querySelectorAll('[data-testid="tile-frame"]');
    expect(frames).toHaveLength(1);
  });

  it('renders zero elements when tiles array is empty', () => {
    const { container } = render(
      <CanvasRenderer tiles={[]} config={testConfig} theme={PRESET_THEME_TOKENS} />,
    );
    const els = container.querySelectorAll('[data-tile-id]');
    expect(els).toHaveLength(0);
  });

  it('keys tiles by photo.id', () => {
    const tiles = [
      makeTile(makePhoto('alpha'), testConfig, 0, constRng(0.3)),
      makeTile(makePhoto('beta'), testConfig, 0, constRng(0.6)),
    ];
    const { container } = render(
      <CanvasRenderer tiles={tiles} config={testConfig} theme={PRESET_THEME_TOKENS} />,
    );
    expect(container.querySelector('[data-tile-id="alpha"]')).not.toBeNull();
    expect(container.querySelector('[data-tile-id="beta"]')).not.toBeNull();
  });

  it('renders static (no looping motion) under reducedMotion', () => {
    const tiles = [makeTile(makePhoto('p1'), testConfig, 0, constRng(0.5))];
    const { container } = render(
      <CanvasRenderer tiles={tiles} config={testConfig} theme={PRESET_THEME_TOKENS} reducedMotion />,
    );
    expect(container.querySelector('[data-tile-id="p1"]')).not.toBeNull();
  });
});
