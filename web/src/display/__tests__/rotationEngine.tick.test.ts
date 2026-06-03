import { describe, it, expect } from 'vitest';
import { tick, enqueueUpload, createEngineState, LEAVE_GRACE_MS } from '../rotationEngine';
import type { EngineState } from '../rotationEngine';
import { makePhoto, testConfig, constRng } from './fixtures';

const cfg3 = { ...testConfig, maxOnCanvas: 3 };
// constRng(0.5) -> deterministic makeTile: dwell = durationMs exactly (variance offset 0).

function albumOf(n: number) {
  return Array.from({ length: n }, (_, i) => makePhoto('a' + i));
}

describe('tick admission', () => {
  it('fills up to maxOnCanvas from album, never exceeding the cap', () => {
    let s: EngineState = createEngineState(albumOf(10), cfg3);
    s = tick(s, 0, constRng(0.5));
    expect(s.onCanvas.length).toBe(3);
    // further ticks at same now do not exceed cap
    s = tick(s, 0, constRng(0.5));
    expect(s.onCanvas.length).toBe(3);
  });

  it('fills only as many as available when album smaller than cap', () => {
    let s: EngineState = createEngineState(albumOf(2), cfg3);
    s = tick(s, 0, constRng(0.5));
    expect(s.onCanvas.filter((t) => !t.leaving).length).toBe(2);
  });

  it('marks oldest non-leaving leaving when a new upload waits and canvas is full', () => {
    let s: EngineState = createEngineState(albumOf(3), cfg3);
    s = tick(s, 0, constRng(0.5)); // fill 3, all bornAt 0
    // bump bornAt ordering by admitting across ticks instead:
    s = createEngineState([], cfg3);
    s = enqueueUpload(s, makePhoto('a0'));
    s = tick(s, 0, constRng(0.5));
    s = enqueueUpload(s, makePhoto('a1'));
    s = tick(s, 10, constRng(0.5));
    s = enqueueUpload(s, makePhoto('a2'));
    s = tick(s, 20, constRng(0.5));
    expect(s.onCanvas.map((t) => t.photo.id).sort()).toEqual(['a0', 'a1', 'a2']);
    // canvas full (3); new upload arrives -> oldest (a0, bornAt 0) marked leaving
    s = enqueueUpload(s, makePhoto('new'));
    s = tick(s, 30, constRng(0.5));
    const a0 = s.onCanvas.find((t) => t.photo.id === 'a0');
    expect(a0?.leaving).toBe(true);
    expect(s.onCanvas.filter((t) => !t.leaving).length).toBe(3); // still capped, new not yet admitted (no free slot until a0 removed)
  });

  it('removes a leaving tile after LEAVE_GRACE_MS then admits the waiting upload', () => {
    let s: EngineState = createEngineState([], cfg3);
    s = enqueueUpload(s, makePhoto('a0'));
    s = tick(s, 0, constRng(0.5));
    s = enqueueUpload(s, makePhoto('a1'));
    s = tick(s, 10, constRng(0.5));
    s = enqueueUpload(s, makePhoto('a2'));
    s = tick(s, 20, constRng(0.5));
    s = enqueueUpload(s, makePhoto('new'));
    s = tick(s, 30, constRng(0.5)); // marks a0 leaving at 30
    s = tick(s, 30 + LEAVE_GRACE_MS, constRng(0.5)); // grace elapsed -> remove a0, admit new
    expect(s.onCanvas.some((t) => t.photo.id === 'a0')).toBe(false);
    expect(s.onCanvas.some((t) => t.photo.id === 'new')).toBe(true);
    expect(s.onCanvas.length).toBe(3);
  });

  it('HARD CAP: non-leaving onCanvas never exceeds maxOnCanvas across a mixed sequence', () => {
    let s: EngineState = createEngineState(albumOf(8), cfg3);
    const assertCap = () =>
      expect(s.onCanvas.filter((t) => !t.leaving).length).toBeLessThanOrEqual(
        s.config.maxOnCanvas,
      );
    // fill
    s = tick(s, 0, constRng(0.5));
    assertCap();
    // repeated ticks (idle), plus uploads, plus dwell crossing, plus grace removals
    for (let i = 1; i <= 12; i += 1) {
      if (i % 3 === 0) s = enqueueUpload(s, makePhoto('up' + i));
      s = tick(s, i * 5000, constRng(0.5));
      assertCap();
    }
    // cross dwell + grace windows several times
    for (const now of [45000, 45000 + LEAVE_GRACE_MS, 90000, 90000 + LEAVE_GRACE_MS]) {
      s = tick(s, now, constRng(0.5));
      assertCap();
    }
  });

  it('dwell expiry marks a tile leaving and frees the slot', () => {
    let s: EngineState = createEngineState(albumOf(5), cfg3);
    s = tick(s, 0, constRng(0.5)); // 3 tiles, dwellMs = 45000 each
    const t0 = s.onCanvas[0];
    s = tick(s, t0.dwellMs, constRng(0.5)); // dwell reached -> at least one marked leaving
    expect(s.onCanvas.some((t) => t.leaving)).toBe(true);
  });

  it('prunes leftAt when a leaving tile is removed past grace (no memory leak)', () => {
    let s: EngineState = createEngineState(albumOf(5), cfg3);
    s = tick(s, 0, constRng(0.5)); // 3 tiles, dwellMs = 45000 each
    const shown = new Set(s.onCanvas.map((t) => t.photo.id));
    s = tick(s, 45000, constRng(0.5)); // dwell -> mark leaving (leftAt populated)
    // while leaving, leftAt holds exactly the currently-leaving tile ids
    const leavingNow = s.onCanvas.filter((t) => t.leaving).map((t) => t.photo.id);
    expect(leavingNow.length).toBeGreaterThan(0);
    for (const id of leavingNow) expect(s.leftAt[id]).toBeDefined();
    s = tick(s, 45000 + LEAVE_GRACE_MS, constRng(0.5)); // remove past grace
    // the removed (now no longer leaving) photos' leftAt entries must be gone.
    const stillLeaving = new Set(
      s.onCanvas.filter((t) => t.leaving).map((t) => t.photo.id),
    );
    for (const id of leavingNow) {
      if (!stillLeaving.has(id)) expect(s.leftAt[id]).toBeUndefined();
    }
    // invariant: leftAt only holds ids of tiles still on canvas AND leaving
    for (const id of Object.keys(s.leftAt)) expect(stillLeaving.has(id)).toBe(true);
    // multi-cycle: drive several dwell+grace rotations; leftAt stays bounded by
    // the number of currently-leaving tiles (<= cap), never accumulating.
    void shown;
    for (let i = 1; i <= 6; i += 1) {
      const base = 45000 + i * 60000;
      s = tick(s, base, constRng(0.5)); // mark dwell-expired leaving
      s = tick(s, base + LEAVE_GRACE_MS, constRng(0.5)); // remove past grace
      const leavingCount = s.onCanvas.filter((t) => t.leaving).length;
      expect(Object.keys(s.leftAt).length).toBe(leavingCount);
      expect(Object.keys(s.leftAt).length).toBeLessThanOrEqual(s.config.maxOnCanvas);
    }
  });

  it('idle cycling pulls fresh album photos over time (least-recently-shown)', () => {
    let s: EngineState = createEngineState(albumOf(5), cfg3);
    s = tick(s, 0, constRng(0.5)); // shows 3 of 5
    const firstShown = new Set(s.onCanvas.map((t) => t.photo.id));
    // advance past dwell so the canvas rotates
    s = tick(s, 45000, constRng(0.5)); // mark dwell-expired leaving
    s = tick(s, 45000 + LEAVE_GRACE_MS, constRng(0.5)); // remove + admit unshown album photos
    const laterShown = new Set(s.onCanvas.map((t) => t.photo.id));
    // at least one newly-shown photo that was not in the first set
    const fresh = [...laterShown].filter((id) => !firstShown.has(id));
    expect(fresh.length).toBeGreaterThan(0);
  });

  it('hidden/lowered cap shrink evicts excess tiles down to the new cap', () => {
    let s: EngineState = createEngineState(albumOf(6), { ...testConfig, maxOnCanvas: 5 });
    s = tick(s, 0, constRng(0.5));
    expect(s.onCanvas.length).toBe(5);
    // lower the cap to 2
    s = { ...s, config: { ...s.config, maxOnCanvas: 2 } };
    s = tick(s, 100, constRng(0.5)); // marks excess leaving
    s = tick(s, 100 + LEAVE_GRACE_MS, constRng(0.5)); // removes them
    expect(s.onCanvas.filter((t) => !t.leaving).length).toBeLessThanOrEqual(2);
    expect(s.onCanvas.length).toBeLessThanOrEqual(2);
  });
});
