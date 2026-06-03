# RTPartyAlbum — Plan 6: Live Display Canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full-screen live "gliding canvas" display (spec §8) for an event. A pure, exhaustively-tested rotation engine decides which photos are on screen (hard cap `maxOnCanvas`, new-upload priority, dwell expiry, idle album cycling). A swappable DOM renderer animates tiles with framer-motion (per-tile motion behavior + enter/leave variants), themed frames and captions, a theme background + ambient layer. `DisplayPage` loads the public event, seeds the engine, connects Socket.IO live updates, runs an animation loop, and respects `prefers-reduced-motion`.

**Architecture:** Plans 1–5 are implemented: the server is complete; the web skeleton exists with `main.tsx`, `router.tsx` (`/e/:code/display` → `DisplayPage` placeholder), `src/api/client.ts` (`getPublicEvent`, `getPublicPhotos`), `src/lib/themeCss.ts`, `src/lib/socket.ts`, `framer-motion` installed, and Vitest + `@testing-library/react` + jsdom set up. This plan adds, under `web/src/display/`, a **pure rotation engine** (`rotationEngine.ts`) plus presentation modules (`motion.ts`, `animations.ts`, `Tile.tsx`, `Backdrop.tsx`) and a renderer behind an interface (`renderer/Renderer.ts`, `renderer/CanvasRenderer.tsx`). `DisplayPage.tsx` wires data + sockets + the loop. All randomness flows through an injectable `Rng` so the engine is deterministic under test; timers are faked in component/page tests.

**Tech Stack:** React ^18.3, TypeScript ^5.4 (ESM), Vite ^5, framer-motion ^11, socket.io-client ^4.7, @tanstack/react-query ^5, react-router-dom ^6.26. Tests: Vitest ^2, @testing-library/react ^16, @testing-library/jest-dom, jsdom. Types imported from `@rtpa/shared` (`MotionConfig`, `MotionStyle`, `EnterAnimation`, `LeaveAnimation`, `Photo`, `PublicEvent`, `Theme`, `ThemeTokens`, `ServerToClientEvents`, `ClientToServerEvents`).

---

## Task 1 — Weighted pick + size (rotationEngine.ts part 1)

**Files:**
- `web/src/display/rotationEngine.ts` (create)
- `web/src/display/__tests__/rotationEngine.weighted.test.ts` (create)

Implements `pickWeighted<K extends string>(weights, rng)` and `computeSize(base, variance, rng)`. `pickWeighted` sums the weights, draws `rng() * total`, walks the entries subtracting each weight, and returns the key whose band the draw lands in; keys with weight `0` are never returned; if total is `0` it returns the first key. `computeSize` maps `rng()` (0..1) linearly into `[base*(1-variance), base*(1+variance)]`.

- [ ] Write failing test `web/src/display/__tests__/rotationEngine.weighted.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pickWeighted, computeSize } from '../rotationEngine';
import type { Rng } from '../rotationEngine';

// Stub rng that returns a fixed sequence, looping.
function seqRng(values: number[]): Rng {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

describe('pickWeighted', () => {
  it('maps draw bands to keys deterministically', () => {
    const weights = { a: 1, b: 2, c: 1 }; // total 4 -> a:[0,.25) b:[.25,.75) c:[.75,1)
    expect(pickWeighted(weights, seqRng([0]))).toBe('a');
    expect(pickWeighted(weights, seqRng([0.2]))).toBe('a');
    expect(pickWeighted(weights, seqRng([0.25]))).toBe('b');
    expect(pickWeighted(weights, seqRng([0.74]))).toBe('b');
    expect(pickWeighted(weights, seqRng([0.75]))).toBe('c');
    expect(pickWeighted(weights, seqRng([0.999]))).toBe('c');
  });

  it('never returns a zero-weight key', () => {
    const weights = { a: 0, b: 1, c: 0 };
    for (let d = 0; d < 100; d += 1) {
      expect(pickWeighted(weights, seqRng([d / 100]))).toBe('b');
    }
  });

  it('returns first key when all weights are zero', () => {
    expect(pickWeighted({ a: 0, b: 0 }, seqRng([0.5]))).toBe('a');
  });
});

describe('computeSize', () => {
  it('returns base when variance is 0', () => {
    expect(computeSize(200, 0, seqRng([0.5]))).toBe(200);
  });

  it('maps rng across [base*(1-variance), base*(1+variance)]', () => {
    expect(computeSize(200, 0.4, seqRng([0]))).toBeCloseTo(120);   // 200*0.6
    expect(computeSize(200, 0.4, seqRng([1]))).toBeCloseTo(280);   // 200*1.4
    expect(computeSize(200, 0.4, seqRng([0.5]))).toBeCloseTo(200);
  });

  it('stays within bounds for arbitrary draws', () => {
    for (let d = 0; d <= 10; d += 1) {
      const s = computeSize(220, 0.4, seqRng([d / 10]));
      expect(s).toBeGreaterThanOrEqual(220 * 0.6 - 1e-9);
      expect(s).toBeLessThanOrEqual(220 * 1.4 + 1e-9);
    }
  });
});
```
- [ ] Run `npm test -w @rtpa/web -- rotationEngine.weighted.test.ts` — expect FAIL (module/exports missing).
- [ ] COMPLETE — create `web/src/display/rotationEngine.ts`:
```ts
import type { MotionConfig, MotionStyle, EnterAnimation, LeaveAnimation, Photo } from '@rtpa/shared';

export interface Tile {
  photo: Photo;
  motion: MotionStyle;
  enter: EnterAnimation;
  leave: LeaveAnimation;
  size: number;            // px longest edge
  x: number; y: number;    // 0..1 normalized position
  rotation: number;        // deg
  bornAt: number;          // ms timestamp admitted
  dwellMs: number;         // computed dwell budget (Infinity if dwell disabled)
  leaving: boolean;
}

export interface EngineState {
  onCanvas: Tile[];
  queue: Photo[];          // waiting to enter (new uploads pushed to front-priority)
  album: Photo[];          // full pool for idle cycling
  config: MotionConfig;
}

export type Rng = () => number;  // injectable for deterministic tests; default Math.random

export function pickWeighted<K extends string>(weights: Record<K, number>, rng: Rng): K {
  const entries = Object.entries(weights) as [K, number][];
  const total = entries.reduce((sum, [, w]) => sum + (w > 0 ? w : 0), 0);
  if (total <= 0) {
    return entries[0][0];
  }
  let draw = rng() * total;
  for (const [key, w] of entries) {
    const weight = w > 0 ? w : 0;
    if (draw < weight) {
      return key;
    }
    draw -= weight;
  }
  // Floating-point safety: return the last non-zero-weight key.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i][1] > 0) {
      return entries[i][0];
    }
  }
  return entries[0][0];
}

export function computeSize(base: number, variance: number, rng: Rng): number {
  const min = base * (1 - variance);
  const max = base * (1 + variance);
  return min + rng() * (max - min);
}
```
- [ ] Run `npm test -w @rtpa/web -- rotationEngine.weighted.test.ts` — expect PASS.
- [ ] Commit: `test: weighted pick + size for rotation engine` (then) `feat: pickWeighted and computeSize`.

---

## Task 2 — makeTile

**Files:**
- `web/src/display/rotationEngine.ts` (modify — add `makeTile`)
- `web/src/display/__tests__/rotationEngine.makeTile.test.ts` (create)
- `web/src/display/__tests__/fixtures.ts` (create — shared test fixtures)

`makeTile(photo, config, now, rng)` builds a `Tile`. Draw order is fixed so tests are deterministic: (1) `motion = pickWeighted(config.motionWeights, rng)`, (2) `enter = pickWeighted(config.enterWeights, rng)`, (3) `leave = pickWeighted(config.leaveWeights, rng)`, (4) `size = computeSize(config.baseSize, config.sizeVariance, rng)`, (5) `x = rng()`, (6) `y = rng()`, (7) `rotation = (rng() * 2 - 1) * MAX_TILE_ROTATION_DEG` (range −8..+8 deg). `bornAt = now`. `dwellMs = config.dwell.enabled ? config.dwell.durationMs + (rng() * 2 - 1) * config.dwell.varianceMs : Infinity` (8th draw, only when dwell enabled). `leaving = false`.

- [ ] Create fixtures `web/src/display/__tests__/fixtures.ts`:
```ts
import type { Photo, MotionConfig } from '@rtpa/shared';
import type { Rng } from '../rotationEngine';

export function makePhoto(id: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    eventId: 'evt1',
    uploaderName: 'Guest ' + id,
    mediaType: 'image',
    width: 1200,
    height: 800,
    durationMs: null,
    createdAt: '2026-06-02T00:00:00.000Z',
    isHidden: false,
    displayUrl: `/media/display/${id}.jpg`,
    thumbUrl: `/media/thumb/${id}.jpg`,
    ...overrides,
  };
}

export const testConfig: MotionConfig = {
  motionWeights: { drift: 5, current: 2, orbit: 1, mosaic: 2 },
  speed: 1,
  maxOnCanvas: 24,
  dwell: { enabled: true, durationMs: 45000, varianceMs: 15000 },
  enterWeights: { flyInEdge: 3, scalePop: 2, fadeGrow: 2, spinIn: 1, dropBounce: 2 },
  leaveWeights: { driftOffEdge: 3, shrinkFade: 3, spinOut: 1, slideAway: 2 },
  baseSize: 220,
  sizeVariance: 0.4,
};

// Returns a fixed sequence rng, looping.
export function seqRng(values: number[]): Rng {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

// Always returns the same value.
export function constRng(v: number): Rng {
  return () => v;
}
```
- [ ] Write failing test `web/src/display/__tests__/rotationEngine.makeTile.test.ts`:
```ts
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

  it('uses Infinity dwell when dwell disabled', () => {
    const cfg = { ...testConfig, dwell: { ...testConfig.dwell, enabled: false } };
    const tile = makeTile(makePhoto('d'), cfg, 0, constRng(0.5));
    expect(tile.dwellMs).toBe(Infinity);
  });
});
```
- [ ] Run `npm test -w @rtpa/web -- rotationEngine.makeTile.test.ts` — expect FAIL.
- [ ] COMPLETE — append to `web/src/display/rotationEngine.ts`:
```ts
export const MAX_TILE_ROTATION_DEG = 8;

export function makeTile(photo: Photo, config: MotionConfig, now: number, rng: Rng): Tile {
  const motion = pickWeighted(config.motionWeights, rng);
  const enter = pickWeighted(config.enterWeights, rng);
  const leave = pickWeighted(config.leaveWeights, rng);
  const size = computeSize(config.baseSize, config.sizeVariance, rng);
  const x = rng();
  const y = rng();
  const rotation = (rng() * 2 - 1) * MAX_TILE_ROTATION_DEG;
  const dwellMs = config.dwell.enabled
    ? config.dwell.durationMs + (rng() * 2 - 1) * config.dwell.varianceMs
    : Infinity;
  return { photo, motion, enter, leave, size, x, y, rotation, bornAt: now, dwellMs, leaving: false };
}
```
- [ ] Run `npm test -w @rtpa/web -- rotationEngine.makeTile.test.ts` — expect PASS.
- [ ] Commit: `feat: makeTile assigns motion/enter/leave/size/dwell`.

---

## Task 3 — enqueueUpload (priority)

**Files:**
- `web/src/display/rotationEngine.ts` (modify — add `enqueueUpload`)
- `web/src/display/__tests__/rotationEngine.enqueue.test.ts` (create)

`enqueueUpload(state, photo)` returns a new `EngineState`. It pushes the photo to the **front** of `queue` (priority). It also ensures the photo is in `album` (append if not present, so idle cycling can re-show it later). It **dedups**: if the photo id is already on canvas (`onCanvas`), or already in `queue`, the queue is left unchanged (no duplicate admission); album membership is still ensured. Admission to the canvas happens only in `tick` — `enqueueUpload` never mutates `onCanvas`.

- [ ] Write failing test `web/src/display/__tests__/rotationEngine.enqueue.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { enqueueUpload, makeTile } from '../rotationEngine';
import type { EngineState } from '../rotationEngine';
import { makePhoto, testConfig, constRng } from './fixtures';

function emptyState(): EngineState {
  return { onCanvas: [], queue: [], album: [], config: testConfig };
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
});
```
- [ ] Run `npm test -w @rtpa/web -- rotationEngine.enqueue.test.ts` — expect FAIL.
- [ ] COMPLETE — append to `web/src/display/rotationEngine.ts`:
```ts
export function enqueueUpload(state: EngineState, photo: Photo): EngineState {
  const inAlbum = state.album.some((p) => p.id === photo.id);
  const album = inAlbum ? state.album : [...state.album, photo];

  const onCanvas = state.onCanvas.some((t) => t.photo.id === photo.id);
  const inQueue = state.queue.some((p) => p.id === photo.id);
  const queue = onCanvas || inQueue ? state.queue : [photo, ...state.queue];

  return { ...state, queue, album };
}
```
- [ ] Run `npm test -w @rtpa/web -- rotationEngine.enqueue.test.ts` — expect PASS.
- [ ] Commit: `feat: enqueueUpload prioritizes new uploads`.

---

## Task 4 — tick (eviction + admission)

**Files:**
- `web/src/display/rotationEngine.ts` (modify — add `tick`)
- `web/src/display/__tests__/rotationEngine.tick.test.ts` (create)

`tick(state, now, rng)` advances the engine one step and returns a new `EngineState`. The contract enforces `onCanvas.length <= config.maxOnCanvas` at all times. **Exact order (prose, also encoded in code):**

1. **Remove fully-left tiles.** Any tile already `leaving` whose leave-grace has elapsed (`now - leaveStartedAt >= LEAVE_GRACE_MS`) is dropped from `onCanvas`. Because `Tile` has no `leaveStartedAt` field, leaving is marked exactly once and the grace is measured from `bornAt + dwellMs` when dwell-driven, or — to keep removal caller-independent and deterministic — we treat the grace as elapsed on the **next** tick after the tile was marked leaving. We implement this concretely by recording the mark time on a private `Symbol`-free numeric field stored on the tile via a parallel `leftAt` property added to the `Tile`. To avoid widening the locked `Tile` type, we instead remove a leaving tile when, on a subsequent tick, the same tile is still leaving AND `now > the now value at which it was marked`. We capture that by storing the mark timestamp in `bornAt`-independent state: we add an internal module field. **Concretely and simply:** a leaving tile is removed on any `tick` whose `now` is strictly greater than the `now` passed to the tick that marked it leaving. We achieve determinism by stamping the mark time into the tile's `rotation`-adjacent metadata is disallowed; therefore we extend the engine with an internal `WeakMap<Tile, number>` `leaveMarks` is also disallowed across pure calls. **Final rule (used by code below):** removal is driven by `LEAVE_GRACE_MS` measured against `bornAt + dwellMs` for dwell-evicted tiles, and against the tick's `now` minus a stamped value for cap-evicted tiles, where the stamp is carried in a new optional `leftAt?: number` we DO add to `EngineState` via a sibling map. To keep this plan unambiguous and the `Tile` type exactly per contract, the implementation below adds an internal `leftAt` to a parallel array `state.leaving` — **see code; tests pin the behavior.**
2. **Mark dwell-expired tiles leaving.** For every non-leaving tile, if `dwellMs !== Infinity && now - bornAt >= dwellMs`, mark it `leaving` and stamp its leave time.
3. **Mark oldest leaving when a slot is demanded.** Compute `waiting = queue.length > 0 || albumHasUnshown(state)`. Compute `nonLeaving = onCanvas.filter(t => !t.leaving)`. While `waiting && nonLeaving.length >= config.maxOnCanvas`, mark the **oldest** non-leaving tile (smallest `bornAt`, ties broken by array order) leaving and stamp it; recompute `nonLeaving`. (Each tick marks at most enough to make room for a single admission, so it marks at most one here in the steady state.)
4. **Admit.** While `nonLeaving.length < config.maxOnCanvas` AND a source has a photo: take from `queue` first (priority, shift from front), else cycle from `album` choosing the **least-recently-shown** photo not currently on canvas or queued; build a `makeTile` and append to `onCanvas`. Stop when `nonLeaving.length === Math.min(config.maxOnCanvas, distinctAvailable)`.

Because the `Tile` type is locked (no `leftAt`), the engine stores leave timestamps in a parallel `Map<string, number>` keyed by photo id inside a new field on `EngineState`: **we add `leftAt: Record<string, number>` to `EngineState`.** This is additive and does not alter the locked `Tile`. `tick` removes a leaving tile once `now - leftAt[id] >= LEAVE_GRACE_MS`.

`albumHasUnshown(state)` = there exists an album photo not on canvas (non-leaving) and not in queue, OR more generally the album has more distinct photos than current non-leaving canvas occupancy (so idle cycling keeps the canvas full up to the cap). For least-recently-shown, the engine tracks `lastShownAt: Record<string, number>` on `EngineState` (stamped to `now` whenever a tile is admitted; album photos never shown have `-Infinity`). **We add `lastShownAt: Record<string, number>` and `leftAt: Record<string, number>` to `EngineState`.**

> **EngineState extension (additive, locked `Tile` untouched):**
> ```ts
> export interface EngineState {
>   onCanvas: Tile[];
>   queue: Photo[];
>   album: Photo[];
>   config: MotionConfig;
>   leftAt: Record<string, number>;      // photoId -> ms when marked leaving
>   lastShownAt: Record<string, number>; // photoId -> ms last admitted
> }
> ```

- [ ] Update the `EngineState` interface in `web/src/display/rotationEngine.ts` to the extended shape above and add `LEAVE_GRACE_MS`. Update `enqueueUpload` to preserve the two new maps (spread already preserves them since it returns `{ ...state, queue, album }`). Add a helper `createEngineState(album, config)` that returns `{ onCanvas: [], queue: [], album: [...album], config, leftAt: {}, lastShownAt: {} }`.
- [ ] Update `fixtures.ts` `emptyState`-style helpers are local to tests; add an exported `createEngineState` usage note. (No fixtures change required beyond importing `createEngineState`.)
- [ ] Write failing test `web/src/display/__tests__/rotationEngine.tick.test.ts`:
```ts
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
    s = enqueueUpload(s, makePhoto('a0')); s = tick(s, 0, constRng(0.5));
    s = enqueueUpload(s, makePhoto('a1')); s = tick(s, 10, constRng(0.5));
    s = enqueueUpload(s, makePhoto('a2')); s = tick(s, 20, constRng(0.5));
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
    s = enqueueUpload(s, makePhoto('a0')); s = tick(s, 0, constRng(0.5));
    s = enqueueUpload(s, makePhoto('a1')); s = tick(s, 10, constRng(0.5));
    s = enqueueUpload(s, makePhoto('a2')); s = tick(s, 20, constRng(0.5));
    s = enqueueUpload(s, makePhoto('new'));
    s = tick(s, 30, constRng(0.5)); // marks a0 leaving at 30
    s = tick(s, 30 + LEAVE_GRACE_MS, constRng(0.5)); // grace elapsed -> remove a0, admit new
    expect(s.onCanvas.some((t) => t.photo.id === 'a0')).toBe(false);
    expect(s.onCanvas.some((t) => t.photo.id === 'new')).toBe(true);
    expect(s.onCanvas.length).toBe(3);
  });

  it('dwell expiry marks a tile leaving and frees the slot', () => {
    let s: EngineState = createEngineState(albumOf(5), cfg3);
    s = tick(s, 0, constRng(0.5)); // 3 tiles, dwellMs = 45000 each
    const t0 = s.onCanvas[0];
    s = tick(s, t0.dwellMs, constRng(0.5)); // dwell reached -> at least one marked leaving
    expect(s.onCanvas.some((t) => t.leaving)).toBe(true);
  });

  it('idle cycling pulls fresh album photos over time (least-recently-shown)', () => {
    let s: EngineState = createEngineState(albumOf(5), cfg3);
    s = tick(s, 0, constRng(0.5)); // shows 3 of 5
    const firstShown = new Set(s.onCanvas.map((t) => t.photo.id));
    // advance past dwell so the canvas rotates
    s = tick(s, 45000, constRng(0.5));            // mark dwell-expired leaving
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
    s = tick(s, 100, constRng(0.5));               // marks excess leaving
    s = tick(s, 100 + LEAVE_GRACE_MS, constRng(0.5)); // removes them
    expect(s.onCanvas.filter((t) => !t.leaving).length).toBeLessThanOrEqual(2);
    expect(s.onCanvas.length).toBeLessThanOrEqual(2);
  });
});
```
- [ ] Run `npm test -w @rtpa/web -- rotationEngine.tick.test.ts` — expect FAIL.
- [ ] COMPLETE — update/append in `web/src/display/rotationEngine.ts`:
```ts
export const LEAVE_GRACE_MS = 1200;

export function createEngineState(album: Photo[], config: MotionConfig): EngineState {
  return { onCanvas: [], queue: [], album: [...album], config, leftAt: {}, lastShownAt: {} };
}

function markLeaving(
  state: EngineState,
  tile: Tile,
  now: number,
): { onCanvas: Tile[]; leftAt: Record<string, number> } {
  const onCanvas = state.onCanvas.map((t) => (t === tile ? { ...t, leaving: true } : t));
  const leftAt = { ...state.leftAt, [tile.photo.id]: now };
  return { onCanvas, leftAt };
}

export function tick(state: EngineState, now: number, rng: Rng): EngineState {
  let onCanvas = state.onCanvas;
  let leftAt = state.leftAt;
  let lastShownAt = state.lastShownAt;
  let queue = state.queue;
  const { config } = state;

  // 1. Remove fully-left tiles (leave grace elapsed).
  onCanvas = onCanvas.filter((t) => {
    if (!t.leaving) return true;
    const mark = leftAt[t.photo.id];
    return !(mark !== undefined && now - mark >= LEAVE_GRACE_MS);
  });

  // 2. Mark dwell-expired non-leaving tiles leaving.
  for (const t of onCanvas) {
    if (!t.leaving && t.dwellMs !== Infinity && now - t.bornAt >= t.dwellMs) {
      const r = markLeaving({ ...state, onCanvas, leftAt }, t, now);
      onCanvas = r.onCanvas;
      leftAt = r.leftAt;
    }
  }

  const onCanvasIds = () => new Set(onCanvas.map((t) => t.photo.id));
  const nonLeaving = () => onCanvas.filter((t) => !t.leaving);

  // helper: distinct album photos not currently on canvas (any state) or queued
  const distinctAvailable = () => {
    const present = onCanvasIds();
    const queued = new Set(queue.map((p) => p.id));
    return state.album.filter((p) => !present.has(p.id) && !queued.has(p.id));
  };

  const waiting = () => queue.length > 0 || distinctAvailable().length > 0;

  // 3. Mark oldest non-leaving leaving while over cap OR while a slot is demanded and full.
  //    Cap-shrink: if non-leaving exceeds cap, always evict oldest down to cap.
  //    Demand: if something waits and non-leaving === cap, evict oldest to free one slot.
  // Loop is bounded by onCanvas length.
  // First handle hard over-cap (e.g. cap lowered):
  while (nonLeaving().length > config.maxOnCanvas) {
    const oldest = [...nonLeaving()].sort((a, b) => a.bornAt - b.bornAt)[0];
    const r = markLeaving({ ...state, onCanvas, leftAt }, oldest, now);
    onCanvas = r.onCanvas;
    leftAt = r.leftAt;
  }
  // Then demand-driven single eviction to make room for a waiting photo:
  if (waiting() && nonLeaving().length >= config.maxOnCanvas) {
    const oldest = [...nonLeaving()].sort((a, b) => a.bornAt - b.bornAt)[0];
    if (oldest) {
      const r = markLeaving({ ...state, onCanvas, leftAt }, oldest, now);
      onCanvas = r.onCanvas;
      leftAt = r.leftAt;
    }
  }

  // 4. Admit from queue (priority) then album-cycle (least-recently-shown), up to cap.
  const admit = (photo: Photo) => {
    const tile = makeTile(photo, config, now, rng);
    onCanvas = [...onCanvas, tile];
    lastShownAt = { ...lastShownAt, [photo.id]: now };
  };

  // queue first
  while (nonLeaving().length < config.maxOnCanvas && queue.length > 0) {
    const present = onCanvasIds();
    const next = queue.find((p) => !present.has(p.id));
    if (!next) break;
    queue = queue.filter((p) => p.id !== next.id);
    admit(next);
  }

  // then album cycle
  while (nonLeaving().length < config.maxOnCanvas) {
    const candidates = distinctAvailable();
    if (candidates.length === 0) break;
    candidates.sort((a, b) => {
      const la = lastShownAt[a.id] ?? -Infinity;
      const lb = lastShownAt[b.id] ?? -Infinity;
      if (la !== lb) return la - lb;       // least-recently-shown first
      return state.album.indexOf(a) - state.album.indexOf(b); // stable tiebreak
    });
    admit(candidates[0]);
  }

  return { ...state, onCanvas, queue, leftAt, lastShownAt };
}
```
- [ ] Run `npm test -w @rtpa/web -- rotationEngine.tick.test.ts` — expect PASS.
- [ ] Commit: `feat: tick eviction + priority/album admission with hard cap`.

---

## Task 4b — removePhoto

**Files:**
- `web/src/display/rotationEngine.ts` (modify — add `removePhoto`)
- `web/src/display/__tests__/rotationEngine.remove.test.ts` (create)

`removePhoto(state, photoId)` returns a new `EngineState` with the photo removed from `onCanvas`, `queue`, and `album`, and its `leftAt`/`lastShownAt` entries cleared. Used for `photo:hidden` and `photo:deleted`.

- [ ] Write failing test `web/src/display/__tests__/rotationEngine.remove.test.ts`:
```ts
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
});
```
- [ ] Run `npm test -w @rtpa/web -- rotationEngine.remove.test.ts` — expect FAIL.
- [ ] COMPLETE — append to `web/src/display/rotationEngine.ts`:
```ts
export function removePhoto(state: EngineState, photoId: string): EngineState {
  const onCanvas = state.onCanvas.filter((t) => t.photo.id !== photoId);
  const queue = state.queue.filter((p) => p.id !== photoId);
  const album = state.album.filter((p) => p.id !== photoId);
  const leftAt = { ...state.leftAt };
  const lastShownAt = { ...state.lastShownAt };
  delete leftAt[photoId];
  delete lastShownAt[photoId];
  return { ...state, onCanvas, queue, album, leftAt, lastShownAt };
}
```
- [ ] Run `npm test -w @rtpa/web -- rotationEngine.remove.test.ts` — expect PASS.
- [ ] Commit: `feat: removePhoto for hidden/deleted media`.

---

## Task 5 — Renderer interface + CanvasRenderer component

**Files:**
- `web/src/display/renderer/Renderer.ts` (create — interface)
- `web/src/display/renderer/CanvasRenderer.tsx` (create — DOM renderer)
- `web/src/display/renderer/__tests__/CanvasRenderer.test.tsx` (create)

`Renderer.ts` defines the swappable interface so a PixiJS renderer could replace the DOM one later. `CanvasRenderer.tsx` is the React/DOM implementation: it renders one positioned `motion.div` per `Tile`, using `x*100%`/`y*100%` for `left`/`top`, `size` px for width, and delegating per-tile content to `Tile.tsx` (Task 8). It applies motion props (Task 6) and enter/leave variants (Task 7) and wraps children in `<AnimatePresence>` so leave animations play.

- [ ] Create `web/src/display/renderer/Renderer.ts`:
```ts
import type { Tile } from '../rotationEngine';
import type { MotionConfig, ThemeTokens } from '@rtpa/shared';
import type { ReactNode } from 'react';

// Swappable renderer interface. The DOM renderer (CanvasRenderer) implements this;
// a PixiJS/WebGL renderer could replace it later without touching the engine.
export interface Renderer {
  renderTiles(tiles: Tile[], config: MotionConfig, theme: ThemeTokens): ReactNode;
}
```
- [ ] Write failing test `web/src/display/renderer/__tests__/CanvasRenderer.test.tsx`:
```ts
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
    // width is the tile size in px
    expect(first.style.width).toBe(`${Math.round(tiles[0].size)}px`);
    // positioned with left/top as percentages
    expect(first.style.left).toBe(`${tiles[0].x * 100}%`);
    expect(first.style.top).toBe(`${tiles[0].y * 100}%`);
  });
});
```
- [ ] Create `web/src/display/renderer/__tests__/testTheme.ts`:
```ts
import type { ThemeTokens } from '@rtpa/shared';

export const PRESET_THEME_TOKENS: ThemeTokens = {
  background: { type: 'solid', value: '#0b1020' },
  ambient: 'none',
  frame: { style: 'thin', borderColor: '#ffffff', borderWidth: 2, radius: 6, shadow: true },
  caption: { enabled: true, bg: '#000000aa', color: '#ffffff' },
  font: 'system-ui',
  accent: '#7c5cff',
};
```
- [ ] Run `npm test -w @rtpa/web -- CanvasRenderer.test.tsx` — expect FAIL.
- [ ] COMPLETE — create `web/src/display/renderer/CanvasRenderer.tsx`:
```ts
import { AnimatePresence, motion } from 'framer-motion';
import type { MotionConfig, ThemeTokens } from '@rtpa/shared';
import type { Tile as TileModel } from '../rotationEngine';
import { Tile } from '../Tile';
import { motionPropsFor } from '../motion';
import { enterVariant, leaveVariant } from '../animations';

interface CanvasRendererProps {
  tiles: TileModel[];
  config: MotionConfig;
  theme: ThemeTokens;
}

export function CanvasRenderer({ tiles, config, theme }: CanvasRendererProps) {
  return (
    <div
      data-testid="canvas-surface"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <AnimatePresence>
        {tiles.map((tile) => {
          const enter = enterVariant(tile.enter);
          const leave = leaveVariant(tile.leave);
          const motionProps = motionPropsFor(tile.motion, config.speed);
          return (
            <motion.div
              key={tile.photo.id}
              data-tile-id={tile.photo.id}
              style={{
                position: 'absolute',
                left: `${tile.x * 100}%`,
                top: `${tile.y * 100}%`,
                width: `${Math.round(tile.size)}px`,
                transformOrigin: 'center center',
              }}
              initial={enter.initial}
              animate={{ ...enter.animate, ...motionProps.animate, rotate: tile.rotation }}
              exit={leave.exit}
              transition={{ ...enter.transition, ...motionProps.transition }}
            >
              <Tile tile={tile} theme={theme} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
```
- [ ] Run `npm test -w @rtpa/web -- CanvasRenderer.test.tsx` — expect PASS (after Tasks 6, 7, 8 modules exist; if running this task first, stub `motion.ts`, `animations.ts`, `Tile.tsx` minimally then complete in their tasks. Sequence: implement Tasks 6, 7, 8 before re-running this test.)
- [ ] Commit: `feat: swappable Renderer interface + DOM CanvasRenderer`.

---

## Task 6 — Motion behaviors (motion.ts)

**Files:**
- `web/src/display/motion.ts` (create)
- `web/src/display/__tests__/motion.test.ts` (create)

`motionPropsFor(style, speed)` returns framer-motion `{ animate, transition }` props for the per-tile ambient motion. Behaviors: **drift** = slow multi-point float (`x`/`y` keyframes); **current** = slow cross-screen horizontal drift; **orbit** = continuous `rotate` plus a circular `x`/`y` path; **mosaic** = gentle parallax pan (small `x`/`y`). Durations scale **inversely** with `speed` (higher speed → shorter duration). All loop (`repeat: Infinity`, `repeatType: 'mirror'` for floats, `'loop'` for orbit), `ease: 'easeInOut'`.

- [ ] Write failing test `web/src/display/__tests__/motion.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { motionPropsFor } from '../motion';

const styles = ['drift', 'current', 'orbit', 'mosaic'] as const;

describe('motionPropsFor', () => {
  it('returns animate + transition with infinite repeat for every style', () => {
    for (const style of styles) {
      const p = motionPropsFor(style, 1);
      expect(p.animate).toBeTypeOf('object');
      expect(p.transition).toBeTypeOf('object');
      expect(p.transition.repeat).toBe(Infinity);
      expect(p.transition.duration).toBeGreaterThan(0);
    }
  });

  it('drift/current/mosaic animate x and/or y keyframes', () => {
    expect(Array.isArray(motionPropsFor('drift', 1).animate.x)).toBe(true);
    expect(Array.isArray(motionPropsFor('current', 1).animate.x)).toBe(true);
    expect(Array.isArray(motionPropsFor('mosaic', 1).animate.y)).toBe(true);
  });

  it('orbit animates rotate over a full turn', () => {
    const p = motionPropsFor('orbit', 1);
    expect(p.animate.rotate).toEqual([0, 360]);
  });

  it('scales duration inversely with speed', () => {
    const slow = motionPropsFor('drift', 0.5).transition.duration;
    const fast = motionPropsFor('drift', 2).transition.duration;
    expect(fast).toBeLessThan(slow);
  });
});
```
- [ ] Run `npm test -w @rtpa/web -- motion.test.ts` — expect FAIL.
- [ ] COMPLETE — create `web/src/display/motion.ts`:
```ts
import type { MotionStyle } from '@rtpa/shared';

export interface MotionProps {
  animate: Record<string, unknown>;
  transition: { duration: number; repeat: number; repeatType: 'mirror' | 'loop'; ease: string };
}

// Base durations (seconds) at speed 1; scaled inversely by speed.
const BASE_DURATION: Record<MotionStyle, number> = {
  drift: 18,
  current: 26,
  orbit: 30,
  mosaic: 22,
};

export function motionPropsFor(style: MotionStyle, speed: number): MotionProps {
  const s = speed > 0 ? speed : 1;
  const duration = BASE_DURATION[style] / s;

  switch (style) {
    case 'drift':
      return {
        animate: { x: [0, 14, -10, 6, 0], y: [0, -10, 8, -6, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    case 'current':
      return {
        animate: { x: [0, 40, 0], y: [0, 6, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    case 'orbit':
      return {
        animate: { rotate: [0, 360], x: [0, 18, 0, -18, 0], y: [0, 18, 0, -18, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'loop', ease: 'easeInOut' },
      };
    case 'mosaic':
    default:
      return {
        animate: { x: [0, 8, -8, 0], y: [0, 6, -6, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
  }
}
```
- [ ] Run `npm test -w @rtpa/web -- motion.test.ts` — expect PASS.
- [ ] Commit: `feat: per-style motion behaviors with speed scaling`.

---

## Task 7 — Enter/leave variants (animations.ts)

**Files:**
- `web/src/display/animations.ts` (create)
- `web/src/display/__tests__/animations.test.ts` (create)

`enterVariant(key)` maps each `EnterAnimation` to `{ initial, animate, transition }`; `leaveVariant(key)` maps each `LeaveAnimation` to `{ exit }` (framer-motion `AnimatePresence` exit props). Enter keys: `flyInEdge`, `scalePop`, `fadeGrow`, `spinIn`, `dropBounce`. Leave keys: `driftOffEdge`, `shrinkFade`, `spinOut`, `slideAway`.

- [ ] Write failing test `web/src/display/__tests__/animations.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { enterVariant, leaveVariant } from '../animations';
import type { EnterAnimation, LeaveAnimation } from '@rtpa/shared';

const enters: EnterAnimation[] = ['flyInEdge', 'scalePop', 'fadeGrow', 'spinIn', 'dropBounce'];
const leaves: LeaveAnimation[] = ['driftOffEdge', 'shrinkFade', 'spinOut', 'slideAway'];

describe('enterVariant', () => {
  it('returns initial/animate/transition for every enter key', () => {
    for (const key of enters) {
      const v = enterVariant(key);
      expect(v.initial).toBeTypeOf('object');
      expect(v.animate).toBeTypeOf('object');
      expect(v.transition).toBeTypeOf('object');
      // opacity resolves to fully visible in animate
      expect(v.animate.opacity).toBe(1);
    }
  });
});

describe('leaveVariant', () => {
  it('returns an exit object for every leave key', () => {
    for (const key of leaves) {
      const v = leaveVariant(key);
      expect(v.exit).toBeTypeOf('object');
    }
  });
});
```
- [ ] Run `npm test -w @rtpa/web -- animations.test.ts` — expect FAIL.
- [ ] COMPLETE — create `web/src/display/animations.ts`:
```ts
import type { EnterAnimation, LeaveAnimation } from '@rtpa/shared';

export interface EnterVariant {
  initial: Record<string, unknown>;
  animate: Record<string, unknown>;
  transition: Record<string, unknown>;
}
export interface LeaveVariant {
  exit: Record<string, unknown>;
}

export function enterVariant(key: EnterAnimation): EnterVariant {
  switch (key) {
    case 'flyInEdge':
      return {
        initial: { opacity: 0, x: -120, y: -60 },
        animate: { opacity: 1, x: 0, y: 0 },
        transition: { type: 'spring', stiffness: 120, damping: 16 },
      };
    case 'scalePop':
      return {
        initial: { opacity: 0, scale: 0.2 },
        animate: { opacity: 1, scale: 1 },
        transition: { type: 'spring', stiffness: 260, damping: 18 },
      };
    case 'fadeGrow':
      return {
        initial: { opacity: 0, scale: 0.85 },
        animate: { opacity: 1, scale: 1 },
        transition: { duration: 0.7, ease: 'easeOut' },
      };
    case 'spinIn':
      return {
        initial: { opacity: 0, rotate: -180, scale: 0.5 },
        animate: { opacity: 1, rotate: 0, scale: 1 },
        transition: { type: 'spring', stiffness: 140, damping: 14 },
      };
    case 'dropBounce':
    default:
      return {
        initial: { opacity: 0, y: -200 },
        animate: { opacity: 1, y: 0 },
        transition: { type: 'spring', stiffness: 200, damping: 12, bounce: 0.6 },
      };
  }
}

export function leaveVariant(key: LeaveAnimation): LeaveVariant {
  switch (key) {
    case 'driftOffEdge':
      return { exit: { opacity: 0, x: 160, y: -40, transition: { duration: 1 } } };
    case 'shrinkFade':
      return { exit: { opacity: 0, scale: 0.3, transition: { duration: 0.8 } } };
    case 'spinOut':
      return { exit: { opacity: 0, rotate: 180, scale: 0.4, transition: { duration: 0.9 } } };
    case 'slideAway':
    default:
      return { exit: { opacity: 0, y: 200, transition: { duration: 0.9 } } };
  }
}
```
- [ ] Run `npm test -w @rtpa/web -- animations.test.ts` — expect PASS.
- [ ] Commit: `feat: enter/leave framer-motion variants`.

---

## Task 8 — Tile component (Tile.tsx)

**Files:**
- `web/src/display/Tile.tsx` (create)
- `web/src/display/__tests__/Tile.test.tsx` (create)

`Tile` renders the media for a tile: an `<img>` for `mediaType === 'image'`, or a muted, looping, autoplay, `playsInline` `<video>` for `'video'` (source = `displayUrl`, poster = `thumbUrl`). It wraps the media in a themed frame derived from `ThemeTokens.frame` (border width/color, radius, shadow; polaroid adds bottom padding) and shows an uploader-name caption pill only when `theme.caption.enabled`.

- [ ] Write failing test `web/src/display/__tests__/Tile.test.tsx`:
```ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tile } from '../Tile';
import { makeTile } from '../rotationEngine';
import { makePhoto, testConfig, constRng } from './fixtures';
import { PRESET_THEME_TOKENS } from '../renderer/__tests__/testTheme';

describe('Tile', () => {
  it('renders an img for image media', () => {
    const tile = makeTile(makePhoto('p1', { mediaType: 'image' }), testConfig, 0, constRng(0.5));
    const { container } = render(<Tile tile={tile} theme={PRESET_THEME_TOKENS} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/media/display/p1.jpg');
  });

  it('renders a muted looping autoplay playsInline video for video media', () => {
    const tile = makeTile(
      makePhoto('v1', { mediaType: 'video', displayUrl: '/media/display/v1.mp4', durationMs: 5000 }),
      testConfig, 0, constRng(0.5),
    );
    const { container } = render(<Tile tile={tile} theme={PRESET_THEME_TOKENS} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.getAttribute('poster')).toBe('/media/thumb/v1.jpg');
  });

  it('shows uploader caption when theme caption enabled', () => {
    const tile = makeTile(makePhoto('p2', { uploaderName: 'Alice' }), testConfig, 0, constRng(0.5));
    render(<Tile tile={tile} theme={PRESET_THEME_TOKENS} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('hides caption when theme caption disabled', () => {
    const tile = makeTile(makePhoto('p3', { uploaderName: 'Bob' }), testConfig, 0, constRng(0.5));
    const theme = { ...PRESET_THEME_TOKENS, caption: { ...PRESET_THEME_TOKENS.caption, enabled: false } };
    render(<Tile tile={tile} theme={theme} />);
    expect(screen.queryByText('Bob')).toBeNull();
  });
});
```
- [ ] Run `npm test -w @rtpa/web -- Tile.test.tsx` — expect FAIL.
- [ ] COMPLETE — create `web/src/display/Tile.tsx`:
```ts
import type { ThemeTokens } from '@rtpa/shared';
import type { Tile as TileModel } from './rotationEngine';

interface TileProps {
  tile: TileModel;
  theme: ThemeTokens;
}

export function Tile({ tile, theme }: TileProps) {
  const { photo } = tile;
  const { frame, caption } = theme;
  const isPolaroid = frame.style === 'polaroid';

  const frameStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    border: frame.style === 'none' ? 'none' : `${frame.borderWidth}px solid ${frame.borderColor}`,
    borderRadius: `${frame.radius}px`,
    boxShadow: frame.shadow ? '0 10px 30px rgba(0,0,0,0.45)' : 'none',
    background: isPolaroid ? '#ffffff' : 'transparent',
    padding: isPolaroid ? '8px 8px 28px 8px' : 0,
    overflow: 'hidden',
    width: '100%',
  };

  const mediaStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: isPolaroid ? 0 : `${Math.max(0, frame.radius - frame.borderWidth)}px`,
  };

  return (
    <div data-testid="tile-frame" style={frameStyle}>
      {photo.mediaType === 'video' ? (
        <video
          style={mediaStyle}
          src={photo.displayUrl}
          poster={photo.thumbUrl}
          muted
          loop
          autoPlay
          playsInline
        />
      ) : (
        <img style={mediaStyle} src={photo.displayUrl} alt={photo.uploaderName} />
      )}
      {caption.enabled && (
        <div
          data-testid="tile-caption"
          style={{
            marginTop: 6,
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 999,
            background: caption.bg,
            color: caption.color,
            fontFamily: theme.font,
            fontSize: 14,
          }}
        >
          {photo.uploaderName}
        </div>
      )}
    </div>
  );
}
```
- [ ] Run `npm test -w @rtpa/web -- Tile.test.tsx` — expect PASS.
- [ ] Commit: `feat: themed Tile with image/video + caption`.

---

## Task 9 — Backdrop (background + ambient)

**Files:**
- `web/src/display/Backdrop.tsx` (create)
- `web/src/display/__tests__/Backdrop.test.tsx` (create)

`Backdrop` renders a full-screen background from `ThemeTokens.background` (`solid` → `backgroundColor`; `gradient` → `backgroundImage`; `image` → `backgroundImage: url(...)` cover) plus an ambient overlay layer keyed by `ThemeTokens.ambient` (`none`/`bokeh`/`particles`/`glow`) via a CSS class `ambient-<name>`.

- [ ] Write failing test `web/src/display/__tests__/Backdrop.test.tsx`:
```ts
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Backdrop } from '../Backdrop';
import { PRESET_THEME_TOKENS } from '../renderer/__tests__/testTheme';

describe('Backdrop', () => {
  it('applies a solid background color', () => {
    const { container } = render(<Backdrop theme={PRESET_THEME_TOKENS} />);
    const bg = container.querySelector('[data-testid="backdrop"]') as HTMLElement;
    expect(bg.style.backgroundColor).toBe('rgb(11, 16, 32)'); // #0b1020
  });

  it('applies a gradient as backgroundImage', () => {
    const theme = {
      ...PRESET_THEME_TOKENS,
      background: { type: 'gradient' as const, value: 'linear-gradient(180deg,#000,#111)' },
    };
    const { container } = render(<Backdrop theme={theme} />);
    const bg = container.querySelector('[data-testid="backdrop"]') as HTMLElement;
    expect(bg.style.backgroundImage).toContain('linear-gradient');
  });

  it('applies an image url for image backgrounds', () => {
    const theme = {
      ...PRESET_THEME_TOKENS,
      background: { type: 'image' as const, value: 'https://x/y.jpg' },
    };
    const { container } = render(<Backdrop theme={theme} />);
    const bg = container.querySelector('[data-testid="backdrop"]') as HTMLElement;
    expect(bg.style.backgroundImage).toContain('url(');
  });

  it('renders an ambient layer with the ambient class', () => {
    const theme = { ...PRESET_THEME_TOKENS, ambient: 'bokeh' as const };
    const { container } = render(<Backdrop theme={theme} />);
    expect(container.querySelector('.ambient-bokeh')).not.toBeNull();
  });
});
```
- [ ] Run `npm test -w @rtpa/web -- Backdrop.test.tsx` — expect FAIL.
- [ ] COMPLETE — create `web/src/display/Backdrop.tsx`:
```ts
import type { ThemeTokens } from '@rtpa/shared';

interface BackdropProps {
  theme: ThemeTokens;
}

function backgroundStyle(bg: ThemeTokens['background']): React.CSSProperties {
  switch (bg.type) {
    case 'solid':
      return { backgroundColor: bg.value };
    case 'gradient':
      return { backgroundImage: bg.value };
    case 'image':
    default:
      return {
        backgroundImage: `url(${bg.value})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
  }
}

export function Backdrop({ theme }: BackdropProps) {
  return (
    <div
      data-testid="backdrop"
      style={{ position: 'absolute', inset: 0, ...backgroundStyle(theme.background) }}
    >
      <div
        className={`ambient-layer ambient-${theme.ambient}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}
```
- [ ] Create CSS-driven ambient styles `web/src/display/ambient.css` and import it from `Backdrop.tsx` (`import './ambient.css';` at top):
```css
.ambient-none { opacity: 0; }
.ambient-glow {
  background: radial-gradient(60% 60% at 50% 40%, rgba(255,255,255,0.18), transparent 70%);
}
.ambient-bokeh {
  background-image:
    radial-gradient(circle at 20% 30%, rgba(255,255,255,0.18) 0 6px, transparent 7px),
    radial-gradient(circle at 70% 60%, rgba(255,255,255,0.12) 0 10px, transparent 11px),
    radial-gradient(circle at 40% 80%, rgba(255,255,255,0.10) 0 8px, transparent 9px);
  filter: blur(2px);
}
.ambient-particles {
  background-image:
    radial-gradient(circle, rgba(255,255,255,0.6) 0 1px, transparent 2px);
  background-size: 48px 48px;
  opacity: 0.25;
}
```
- [ ] Run `npm test -w @rtpa/web -- Backdrop.test.tsx` — expect PASS.
- [ ] Commit: `feat: themed Backdrop with ambient effect layer`.

---

## Task 10 — DisplayPage + route wiring

**Files:**
- `web/src/pages/DisplayPage.tsx` (create — replaces placeholder)
- `web/src/router.tsx` (modify — wire `/e/:code/display` → `DisplayPage`)
- `web/src/pages/__tests__/DisplayPage.test.tsx` (create)

`DisplayPage` reads `:code` from the route, fetches `PublicEvent` (`getPublicEvent`) and visible photos (`getPublicPhotos`), builds an `EngineState` (`createEngineState(photos, motionConfig)`), seeds the canvas by calling `tick` repeatedly at `now=0` until it fills to the cap (one pass suffices since admission loops to cap), connects the socket (`getSocket`/`connectSocket` from `src/lib/socket.ts`), `emit('join', code)`, and subscribes to the five server events. It runs an animation loop on an interval (default 1000ms cadence) that calls `tick(state, performance.now-based now, rng)` and commits new state. It respects `prefers-reduced-motion`: when reduced, it disables ambient motion props (renders with a static/fade-only path — pass `reducedMotion` to the renderer which short-circuits `motion.animate` to a simple fade) and uses a calmer config copy.

Socket handlers: `photo:added` → `setState(enqueueUpload(state, photo))`; `photo:hidden`/`photo:deleted` → `setState(removePhoto(state, payload.id))`; `settings:updated` → replace `config` (re-evaluates cap on next tick); `theme:updated` → swap theme tokens. Injectables for tests: `DisplayPage` accepts optional props `{ rng?, tickMs?, now? }` (default `rng = Math.random`, `tickMs = 1000`, `now = () => performance.now()`).

**Reduced motion:** `DisplayPage` reads `window.matchMedia('(prefers-reduced-motion: reduce)').matches`. When true it passes `reducedMotion` to `CanvasRenderer`, which (extend Task 5 component to accept an optional `reducedMotion` prop) replaces per-tile `motionProps.animate`/`transition` with a single fade-in and no looping motion.

- [ ] Extend `CanvasRenderer` to accept `reducedMotion?: boolean`; when true, set `animate={{ opacity: 1, rotate: tile.rotation }}` and `transition={{ duration: 0.4 }}` (no `motionProps`). Add a quick assertion in `CanvasRenderer.test.tsx`:
```ts
it('renders static (no looping motion) under reducedMotion', () => {
  const tiles = [makeTile(makePhoto('p1'), testConfig, 0, constRng(0.5))];
  const { container } = render(
    <CanvasRenderer tiles={tiles} config={testConfig} theme={PRESET_THEME_TOKENS} reducedMotion />,
  );
  expect(container.querySelector('[data-tile-id="p1"]')).not.toBeNull();
});
```
- [ ] Write failing test `web/src/pages/__tests__/DisplayPage.test.tsx`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisplayPage } from '../DisplayPage';
import { makePhoto, testConfig } from '../../display/__tests__/fixtures';
import { PRESET_THEME_TOKENS } from '../../display/renderer/__tests__/testTheme';
import type { PublicEvent, Photo } from '@rtpa/shared';

// --- fakes ---
const fakeSocket = {
  handlers: {} as Record<string, (...args: any[]) => void>,
  emit: vi.fn(),
  on(ev: string, cb: (...args: any[]) => void) { this.handlers[ev] = cb; },
  off: vi.fn(),
  disconnect: vi.fn(),
};
vi.mock('../../lib/socket', () => ({
  getSocket: () => fakeSocket,
  connectSocket: () => fakeSocket,
}));

const publicEvent: PublicEvent = {
  code: 'ABC',
  name: 'Party',
  status: 'active',
  uploadEnabled: true,
  theme: { id: 't1', name: 'T', isPreset: true, tokens: PRESET_THEME_TOKENS },
  motionConfig: { ...testConfig, maxOnCanvas: 3 },
};
let albumPhotos: Photo[] = [];
vi.mock('../../api/client', () => ({
  getPublicEvent: vi.fn(async () => publicEvent),
  getPublicPhotos: vi.fn(async () => albumPhotos),
}));

function renderPage(rng = () => 0.5) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/e/ABC/display']}>
        <Routes>
          <Route path="/e/:code/display" element={<DisplayPage rng={rng} tickMs={1000} now={() => 0} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeSocket.handlers = {};
  fakeSocket.emit.mockClear();
  albumPhotos = Array.from({ length: 6 }, (_, i) => makePhoto('a' + i));
  // default: motion not reduced
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
  }));
});
afterEach(() => { vi.useRealTimers(); });

describe('DisplayPage', () => {
  it('initial fill does not exceed maxOnCanvas and joins the room', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBeGreaterThan(0));
    expect(container.querySelectorAll('[data-tile-id]').length).toBeLessThanOrEqual(3);
    expect(fakeSocket.emit).toHaveBeenCalledWith('join', 'ABC');
  });

  it('photo:added causes the new upload to be admitted', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBe(3));
    act(() => { fakeSocket.handlers['photo:added'](makePhoto('NEW')); });
    // advance a couple of ticks + leave grace for displacement
    act(() => { vi.advanceTimersByTime(5000); });
    await waitFor(() =>
      expect(container.querySelector('[data-tile-id="NEW"]')).not.toBeNull(),
    );
    expect(container.querySelectorAll('[data-tile-id]').length).toBeLessThanOrEqual(3);
  });

  it('settings:updated lowering maxOnCanvas evicts down to the new cap', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBe(3));
    act(() => { fakeSocket.handlers['settings:updated']({ ...testConfig, maxOnCanvas: 1 }); });
    act(() => { vi.advanceTimersByTime(5000); });
    await waitFor(() =>
      expect(container.querySelectorAll('[data-tile-id]').length).toBeLessThanOrEqual(1),
    );
  });

  it('photo:deleted removes the tile', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBe(3));
    const id = (container.querySelector('[data-tile-id]') as HTMLElement).getAttribute('data-tile-id')!;
    act(() => { fakeSocket.handlers['photo:deleted']({ id }); });
    act(() => { vi.advanceTimersByTime(2000); });
    await waitFor(() => expect(container.querySelector(`[data-tile-id="${id}"]`)).toBeNull());
  });

  it('reduced-motion renders a static path', async () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
    }));
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBeGreaterThan(0));
    expect(container.querySelector('[data-testid="canvas-surface"]')).not.toBeNull();
  });
});
```
- [ ] Run `npm test -w @rtpa/web -- DisplayPage.test.tsx` — expect FAIL.
- [ ] COMPLETE — create `web/src/pages/DisplayPage.tsx`:
```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { MotionConfig, Photo, Theme } from '@rtpa/shared';
import { getPublicEvent, getPublicPhotos } from '../api/client';
import { connectSocket } from '../lib/socket';
import {
  createEngineState,
  enqueueUpload,
  removePhoto,
  tick,
  type EngineState,
  type Rng,
} from '../display/rotationEngine';
import { CanvasRenderer } from '../display/renderer/CanvasRenderer';
import { Backdrop } from '../display/Backdrop';

interface DisplayPageProps {
  rng?: Rng;
  tickMs?: number;
  now?: () => number;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function DisplayPage({ rng = Math.random, tickMs = 1000, now = () => performance.now() }: DisplayPageProps) {
  const { code = '' } = useParams();
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  const eventQuery = useQuery({ queryKey: ['public-event', code], queryFn: () => getPublicEvent(code), enabled: !!code });
  const photosQuery = useQuery({ queryKey: ['public-photos', code], queryFn: () => getPublicPhotos(code), enabled: !!code });

  const [state, setState] = useState<EngineState | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const stateRef = useRef<EngineState | null>(null);
  stateRef.current = state;

  // Seed engine once both queries are ready.
  useEffect(() => {
    if (!eventQuery.data || !photosQuery.data) return;
    setTheme(eventQuery.data.theme);
    let s = createEngineState(photosQuery.data, eventQuery.data.motionConfig);
    s = tick(s, 0, rng); // single tick fills up to the cap
    setState(s);
  }, [eventQuery.data, photosQuery.data, rng]);

  // Socket wiring.
  useEffect(() => {
    if (!code) return;
    const socket = connectSocket();
    socket.emit('join', code);

    const onAdded = (photo: Photo) => setState((s) => (s ? enqueueUpload(s, photo) : s));
    const onHidden = (p: { id: string }) => setState((s) => (s ? removePhoto(s, p.id) : s));
    const onDeleted = (p: { id: string }) => setState((s) => (s ? removePhoto(s, p.id) : s));
    const onSettings = (motionConfig: MotionConfig) =>
      setState((s) => (s ? { ...s, config: motionConfig } : s));
    const onTheme = (t: Theme) => setTheme(t);

    socket.on('photo:added', onAdded);
    socket.on('photo:hidden', onHidden);
    socket.on('photo:deleted', onDeleted);
    socket.on('settings:updated', onSettings);
    socket.on('theme:updated', onTheme);

    return () => {
      socket.off('photo:added', onAdded);
      socket.off('photo:hidden', onHidden);
      socket.off('photo:deleted', onDeleted);
      socket.off('settings:updated', onSettings);
      socket.off('theme:updated', onTheme);
    };
  }, [code]);

  // Animation/rotation loop.
  useEffect(() => {
    if (!state) return;
    const id = setInterval(() => {
      const current = stateRef.current;
      if (!current) return;
      setState(tick(current, now(), rng));
    }, tickMs);
    return () => clearInterval(id);
  }, [state !== null, tickMs, now, rng]);

  if (eventQuery.isError) {
    return <div data-testid="display-error" style={{ color: '#fff' }}>Event not found</div>;
  }
  if (!state || !theme) {
    return <div data-testid="display-loading" style={{ position: 'absolute', inset: 0, background: '#000' }} />;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <Backdrop theme={theme.tokens} />
      <CanvasRenderer
        tiles={state.onCanvas}
        config={state.config}
        theme={theme.tokens}
        reducedMotion={reducedMotion}
      />
    </div>
  );
}
```
- [ ] Wire route — in `web/src/router.tsx` replace the placeholder. Replace the lazy/placeholder element for `/e/:code/display` with `element={<DisplayPage />}` and add `import { DisplayPage } from './pages/DisplayPage';` (remove the placeholder import). Concretely, change the route object/JSX so the display path renders `<DisplayPage />`.
- [ ] Run `npm test -w @rtpa/web -- DisplayPage.test.tsx` — expect PASS. Also re-run `npm test -w @rtpa/web -- CanvasRenderer.test.tsx` for the reducedMotion assertion.
- [ ] Run the full web suite: `npm test -w @rtpa/web` — expect all PASS.
- [ ] Commit: `feat: DisplayPage live canvas with sockets + loop + reduced-motion` and `feat: wire /e/:code/display to DisplayPage`.

---

## Plan 6 self-check

Maps to spec §8 (Live display canvas) and §9 (admin controls applied live):

- **Hard cap, never exceeded** (§8 rotation model) → Task 4 `tick` enforces `onCanvas.length <= maxOnCanvas`; tests assert cap never exceeded and cap-shrink eviction.
- **Tile leaves on dwell expiry or oldest-when-waiting** (§8) → Task 4 steps 2–3; deterministic tests for dwell expiry and oldest-eviction.
- **Leaving frees a slot; next photo enters** (§8) → Task 4 step 1 (grace removal) + step 4 (admission); test admits waiting upload after `LEAVE_GRACE_MS`.
- **New uploads get priority; oldest cycles out when full** (§8) → Tasks 3 + 4; `enqueueUpload` front-priority + tick displaces oldest; DisplayPage `photo:added` test.
- **Idle album cycling keeps canvas full** (§8) → Task 4 least-recently-shown admission; idle-cycling test.
- **Dwell timeout on/off + duration + variance** (§8/§9) → Task 2 `makeTile` (`Infinity` when off; duration ± variance via rng).
- **Per-tile motion behavior Drift/Current/Orbit/Mosaic by weights** (§8/§9) → Task 1 `pickWeighted`, Task 6 `motionPropsFor`.
- **Size from base + variance** (§8/§9) → Task 1 `computeSize`; Task 2 assigns.
- **Enter/leave "cute animations" by weights** (§8/§9) → Task 1 weighting, Task 7 variants, Task 2 assignment.
- **Tile rendering: image or muted looping video, themed frame + optional caption** (§8) → Task 8 `Tile`.
- **Theme background + ambient effect** (§10 surfaced on display) → Task 9 `Backdrop`.
- **Live updates via Socket.IO (theme/weights/speed/size/count/dwell, hide/delete)** (§8/§9/§12) → Task 10 socket handlers (`photo:added/hidden/deleted`, `settings:updated`, `theme:updated`).
- **Swappable renderer (DOM now, PixiJS later)** (§4) → Task 5 `Renderer` interface + `CanvasRenderer`.
- **Respects prefers-reduced-motion with gentle fallback** (§8) → Task 10 reduced-motion path + Task 5 static render.
- **Renderer kept modular / no controls full-screen display** (§5/§4) → Task 10 full-screen `DisplayPage`, route wired.
