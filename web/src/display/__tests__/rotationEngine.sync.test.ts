import { describe, it, expect } from 'vitest';
import { createEngineState, syncAlbum, tick } from '../rotationEngine';
import { makePhoto, testConfig, constRng } from './fixtures';

describe('syncAlbum', () => {
  it('drops photos missing from the fresh list (hidden/deleted while offline)', () => {
    let s = createEngineState([makePhoto('a'), makePhoto('b')], testConfig);
    s = tick(s, 0, constRng(0.5));
    s = syncAlbum(s, [makePhoto('a')]);
    expect(s.album.map((p) => p.id)).toEqual(['a']);
    expect(s.onCanvas.map((t) => t.photo.id)).toEqual(['a']);
  });

  it('enqueues unseen photos with the newest at the front', () => {
    const s0 = createEngineState([makePhoto('a')], testConfig);
    // API order is newest-first.
    const s = syncAlbum(s0, [makePhoto('new2'), makePhoto('new1'), makePhoto('a')]);
    expect(s.queue.map((p) => p.id)).toEqual(['new2', 'new1']);
    expect(s.album.map((p) => p.id).sort()).toEqual(['a', 'new1', 'new2']);
  });

  it('refreshes known photos in place (e.g. a missed favorite toggle)', () => {
    let s = createEngineState([makePhoto('a')], testConfig);
    s = tick(s, 0, constRng(0.5));
    s = syncAlbum(s, [makePhoto('a', { isPriority: true })]);
    expect(s.album[0].isPriority).toBe(true);
    expect(s.onCanvas[0].photo.isPriority).toBe(true);
    expect(s.queue).toEqual([]);
  });
});
