import { describe, it, expect } from 'vitest';
import { makeTile, MAX_TILE_ROTATION_DEG } from '../rotationEngine';
import { makePhoto, testConfig, seqRng, constRng } from './fixtures';

describe('makeTile', () => {
  it('assigns fields deterministically in draw order', () => {
    // draws: motion, enter, leave, size, x, y, rotation, dwell
    const rng = seqRng([0, 0, 0, 0.5, 0.3, 0.7, 0.5, 0.5]);
    const tile = makeTile(makePhoto('p1'), testConfig, 1000, rng);
    expect(tile.motion).toBe('drift');       // first key, draw 0
    expect(tile.enter).toBe('flyInEdge');
    expect(tile.leave).toBe('driftOffEdge');
    expect(tile.size).toBeCloseTo(220);       // variance 0.4, draw .5 -> base
    expect(tile.x).toBeCloseTo(0.3);
    expect(tile.y).toBeCloseTo(0.7);
    expect(tile.rotation).toBeCloseTo(0);     // (0.5*2-1)=0
    expect(tile.bornAt).toBe(1000);
    expect(tile.dwellMs).toBeCloseTo(45000);  // (0.5*2-1)=0 variance offset
    expect(tile.leaving).toBe(false);
  });

  it('keeps rotation within +/- MAX_TILE_ROTATION_DEG', () => {
    const lo = makeTile(makePhoto('a'), testConfig, 0, seqRng([0, 0, 0, 0.5, 0.5, 0.5, 0, 0.5]));
    const hi = makeTile(makePhoto('b'), testConfig, 0, seqRng([0, 0, 0, 0.5, 0.5, 0.5, 1, 0.5]));
    expect(lo.rotation).toBeCloseTo(-MAX_TILE_ROTATION_DEG);
    expect(hi.rotation).toBeCloseTo(MAX_TILE_ROTATION_DEG);
  });

  it('applies dwell variance offset from final draw', () => {
    const tile = makeTile(makePhoto('c'), testConfig, 0, seqRng([0, 0, 0, 0.5, 0.5, 0.5, 0.5, 1]));
    expect(tile.dwellMs).toBeCloseTo(60000); // 45000 + (1*2-1)*15000
  });

  it('draws the resting tilt from the configured [min,max] range', () => {
    const cfg = { ...testConfig, tiltMinDeg: 2, tiltMaxDeg: 10 };
    // rotation is the 7th draw (index 6): min + draw*(max-min)
    const lo = makeTile(makePhoto('a'), cfg, 0, seqRng([0, 0, 0, 0.5, 0.5, 0.5, 0, 0.5]));
    const mid = makeTile(makePhoto('b'), cfg, 0, seqRng([0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5]));
    const hi = makeTile(makePhoto('c'), cfg, 0, seqRng([0, 0, 0, 0.5, 0.5, 0.5, 1, 0.5]));
    expect(lo.rotation).toBeCloseTo(2); // min
    expect(mid.rotation).toBeCloseTo(6); // midpoint
    expect(hi.rotation).toBeCloseTo(10); // max
  });

  it('uses Infinity dwell when dwell disabled', () => {
    const cfg = { ...testConfig, dwell: { ...testConfig.dwell, enabled: false } };
    const tile = makeTile(makePhoto('d'), cfg, 0, constRng(0.5));
    expect(tile.dwellMs).toBe(Infinity);
  });
});
