import { describe, it, expect } from 'vitest';
import {
  createEngineState,
  makeTile,
  tick,
  updatePhoto,
  type EngineState,
} from '../rotationEngine';
import { makePhoto, testConfig, constRng } from './fixtures';

describe('rotationEngine priority/favorite weighting', () => {
  it('admits favorited photos to the canvas before non-favorites', () => {
    const cfg = { ...testConfig, maxOnCanvas: 1, dwell: { ...testConfig.dwell, enabled: false } };
    // Album order puts the favorite in the MIDDLE, so winning a single slot can
    // only be due to the priority sort (not album order or recency).
    const album = [
      makePhoto('a'),
      makePhoto('fav', { isPriority: true }),
      makePhoto('c'),
    ];
    const s = tick(createEngineState(album, cfg), 0, constRng(0.5));
    expect(s.onCanvas.map((t) => t.photo.id)).toEqual(['fav']);
  });

  it('evicts the oldest non-favorite first, keeping favorites on screen longer', () => {
    const cfg = { ...testConfig, maxOnCanvas: 2 };
    const tNon1 = makeTile(makePhoto('non1'), cfg, 0, constRng(0.5)); // oldest
    const tFav = makeTile(makePhoto('fav', { isPriority: true }), cfg, 1, constRng(0.5));
    const tNon2 = makeTile(makePhoto('non2'), cfg, 2, constRng(0.5));
    const state: EngineState = {
      onCanvas: [tNon1, tFav, tNon2],
      queue: [],
      album: [tNon1.photo, tFav.photo, tNon2.photo],
      config: cfg,
      leftAt: {},
      lastShownAt: {},
    };
    const next = tick(state, 100, constRng(0.5)); // over cap by 1 -> evict one
    const leaving = next.onCanvas.filter((t) => t.leaving).map((t) => t.photo.id);
    expect(leaving).toEqual(['non1']); // oldest non-favorite evicted
    expect(leaving).not.toContain('fav'); // favorite stays
  });

  it('updatePhoto applies a priority change to album and on-canvas tiles', () => {
    const cfg = { ...testConfig, maxOnCanvas: 5, dwell: { ...testConfig.dwell, enabled: false } };
    const photo = makePhoto('x');
    let s = tick(createEngineState([photo], cfg), 0, constRng(0.5));
    expect(s.onCanvas.find((t) => t.photo.id === 'x')?.photo.isPriority).toBe(false);

    s = updatePhoto(s, { ...photo, isPriority: true });
    expect(s.album.find((p) => p.id === 'x')?.isPriority).toBe(true);
    expect(s.onCanvas.find((t) => t.photo.id === 'x')?.photo.isPriority).toBe(true);
  });
});
