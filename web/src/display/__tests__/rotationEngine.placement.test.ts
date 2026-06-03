import { describe, it, expect } from 'vitest';
import { makeTile, placeTile, type Tile } from '../rotationEngine';
import { makePhoto, testConfig, constRng, seqRng } from './fixtures';

function tileAt(id: string, x: number, y: number, size: number, bornAt: number): Tile {
  return { ...makeTile(makePhoto(id), testConfig, bornAt, constRng(0.5)), x, y, size, bornAt };
}

describe('placeTile (collision-aware placement)', () => {
  it('returns the tile’s own position when the canvas is empty', () => {
    const t = tileAt('n', 0.3, 0.7, 220, 0);
    expect(placeTile([], t, constRng(0.5))).toEqual({ x: 0.3, y: 0.7 });
  });

  it('places a new photo in empty space, avoiding an existing photo', () => {
    // One small existing tile near the center; the only empty candidate is the corner.
    const existing = [tileAt('a', 0.5, 0.5, 120, 0)];
    const newTile = tileAt('new', 0, 0, 240, 100);
    // Candidate 0 -> far corner (no overlap); all later candidates -> center (overlap).
    const vals: number[] = [0.96, 0.96];
    for (let i = 0; i < 31; i += 1) vals.push(0.5, 0.5);
    const pos = placeTile(existing, newTile, seqRng(vals));
    expect(pos.x).toBeCloseTo(0.96);
    expect(pos.y).toBeCloseTo(0.96);
  });

  it('when overlap is unavoidable, covers the OLDEST photo rather than a recent one', () => {
    // Two big tiles fill the canvas: an OLD one on the left, a NEW one on the right.
    const old = tileAt('old', 0, 0.5, 1700, 0); // bornAt 0  -> lowest cover penalty
    const recent = tileAt('recent', 1, 0.5, 1700, 1000); // newest -> highest penalty
    const newTile = tileAt('new', 0, 0.5, 300, 2000);
    // Candidate 0 -> left (over the OLD photo); all others -> right (over the RECENT one).
    const vals: number[] = [0.02, 0.5];
    for (let i = 0; i < 31; i += 1) vals.push(0.98, 0.5);
    const pos = placeTile([old, recent], newTile, seqRng(vals));
    expect(pos.x).toBeLessThan(0.5); // chose the left/older side
  });
});
