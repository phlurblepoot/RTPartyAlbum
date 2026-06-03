import { describe, it, expect } from 'vitest';
import { removePhoto, enqueueUpload, tick, createEngineState } from '../rotationEngine';
import type { EngineState } from '../rotationEngine';
import { makePhoto, testConfig, constRng } from './fixtures';

describe('removePhoto', () => {
  it('removes from onCanvas, queue, and album', () => {
    let s: EngineState = createEngineState([makePhoto('x'), makePhoto('y')], { ...testConfig, maxOnCanvas: 1 });
    s = tick(s, 0, constRng(0.5));            // one of x/y on canvas
    s = enqueueUpload(s, makePhoto('z'));     // z in queue + album
    const onId = s.onCanvas[0].photo.id;
    s = removePhoto(s, onId);
    expect(s.onCanvas.some((t) => t.photo.id === onId)).toBe(false);
    expect(s.album.some((p) => p.id === onId)).toBe(false);
    s = removePhoto(s, 'z');
    expect(s.queue.some((p) => p.id === 'z')).toBe(false);
    expect(s.album.some((p) => p.id === 'z')).toBe(false);
  });

  it('clears leftAt and lastShownAt entries', () => {
    let s: EngineState = createEngineState([makePhoto('x')], testConfig);
    s = tick(s, 0, constRng(0.5));
    s = removePhoto(s, 'x');
    expect(s.lastShownAt['x']).toBeUndefined();
    expect(s.leftAt['x']).toBeUndefined();
  });

  it('is a no-op for an unknown photo id', () => {
    const s: EngineState = createEngineState([makePhoto('x'), makePhoto('y')], testConfig);
    const s2 = removePhoto(s, 'nonexistent');
    expect(s2.album).toEqual(s.album);
    expect(s2.queue).toEqual(s.queue);
    expect(s2.onCanvas).toEqual(s.onCanvas);
    expect(s2.leftAt).toEqual(s.leftAt);
    expect(s2.lastShownAt).toEqual(s.lastShownAt);
  });

  it('does not mutate the input state', () => {
    let s: EngineState = createEngineState([makePhoto('x'), makePhoto('y')], { ...testConfig, maxOnCanvas: 2 });
    s = tick(s, 0, constRng(0.5));
    const origOnCanvas = s.onCanvas;
    const origAlbum = s.album;
    const origQueue = s.queue;
    const origLeftAt = s.leftAt;
    const origLastShownAt = s.lastShownAt;
    removePhoto(s, 'x');
    expect(s.onCanvas).toBe(origOnCanvas);
    expect(s.album).toBe(origAlbum);
    expect(s.queue).toBe(origQueue);
    expect(s.leftAt).toBe(origLeftAt);
    expect(s.lastShownAt).toBe(origLastShownAt);
  });
});
