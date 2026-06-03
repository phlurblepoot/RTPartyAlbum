import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CanvasRenderer, tilePosition, EDGE_MARGIN_PX } from '../CanvasRenderer';
import { motionTravelPx } from '../../motion';
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
    const pos = tilePosition(tiles[0], PRESET_THEME_TOKENS.caption.enabled);
    // width is the tile size in px
    expect(first.style.width).toBe(`${pos.size}px`);
    // positioned within the edge-safe band (margin + glide travel inset, and the
    // vertical band reserves the tile's true rendered height).
    expect(first.style.left).toBe(pos.left);
    expect(first.style.top).toBe(pos.top);
  });

  it('insets tiles from the edge by margin + glide travel and reserves portrait height', () => {
    // A portrait photo (taller than wide) at the far corner (x=y=1).
    const portrait = makePhoto('port', { width: 800, height: 1200 });
    const tile = { ...makeTile(portrait, testConfig, 0, constRng(0.9)), x: 1, y: 1 };
    const { left, top } = tilePosition(tile, true);
    const inset = EDGE_MARGIN_PX + motionTravelPx(tile.motion);
    const size = Math.round(tile.size);
    const height = Math.round(size * (1200 / 800)) + 34; // aspect height + caption allowance
    // At x=1/y=1 the tile sits at (100% - size - inset) / (100% - height - inset):
    // a full `inset` gutter remains on the trailing edge, and the band reserves the
    // taller portrait height so the bottom never overflows.
    expect(left).toBe(`calc(${inset}px + 1 * (100% - ${size + inset * 2}px))`);
    expect(top).toBe(`calc(${inset}px + 1 * (100% - ${height + inset * 2}px))`);
    expect(height).toBeGreaterThan(size); // portrait reserves more vertical room than width
  });

  it('still renders a leaving tile (drives its exit choreography)', () => {
    const tile = { ...makeTile(makePhoto('go'), testConfig, 0, constRng(0.5)), leaving: true };
    const { container } = render(
      <CanvasRenderer tiles={[tile]} config={testConfig} theme={PRESET_THEME_TOKENS} />,
    );
    expect(container.querySelector('[data-tile-id="go"]')).not.toBeNull();
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
