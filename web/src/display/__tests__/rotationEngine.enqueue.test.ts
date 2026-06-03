import { describe, it, expect } from 'vitest';
import { enqueueUpload, makeTile } from '../rotationEngine';
import type { EngineState } from '../rotationEngine';
import { makePhoto, testConfig, constRng } from './fixtures';

function emptyState(): EngineState {
  return { onCanvas: [], queue: [], album: [], config: testConfig, leftAt: {}, lastShownAt: {} };
}

describe('enqueueUpload', () => {
  it('pushes to the front of the queue (priority)', () => {
    let s = emptyState();
    s = enqueueUpload(s, makePhoto('old'));
    s = enqueueUpload(s, makePhoto('new'));
    expect(s.queue.map((p) => p.id)).toEqual(['new', 'old']);
  });

  it('adds photo to album for later idle cycling', () => {
    let s = emptyState();
    s = enqueueUpload(s, makePhoto('p1'));
    expect(s.album.map((p) => p.id)).toContain('p1');
  });

  it('does not duplicate a photo already in the queue', () => {
    let s = emptyState();
    s = enqueueUpload(s, makePhoto('p1'));
    s = enqueueUpload(s, makePhoto('p1'));
    expect(s.queue.filter((p) => p.id === 'p1')).toHaveLength(1);
  });

  it('does not queue a photo already on canvas', () => {
    const tile = makeTile(makePhoto('onc'), testConfig, 0, constRng(0.5));
    let s: EngineState = { ...emptyState(), onCanvas: [tile], album: [tile.photo] };
    s = enqueueUpload(s, makePhoto('onc'));
    expect(s.queue).toHaveLength(0);
  });

  it('does not mutate onCanvas', () => {
    let s = emptyState();
    s = enqueueUpload(s, makePhoto('p1'));
    expect(s.onCanvas).toHaveLength(0);
  });

  it('does not mutate input state arrays', () => {
    const original = emptyState();
    const originalQueue = original.queue;
    const originalAlbum = original.album;
    const result = enqueueUpload(original, makePhoto('p1'));
    expect(originalQueue).toHaveLength(0);
    expect(originalAlbum).toHaveLength(0);
    expect(result.queue).not.toBe(originalQueue);
    expect(result.album).not.toBe(originalAlbum);
  });
});
