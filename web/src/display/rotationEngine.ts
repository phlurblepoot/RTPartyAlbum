import type { MotionConfig, MotionStyle, EnterAnimation, LeaveAnimation, Photo } from '@rtpa/shared';

export interface Tile {
  photo: Photo;
  motion: MotionStyle;
  enter: EnterAnimation;
  leave: LeaveAnimation;
  size: number;            // px longest edge
  x: number; y: number;   // 0..1 normalized position
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
  leftAt: Record<string, number>;      // photoId -> ms when marked leaving
  lastShownAt: Record<string, number>; // photoId -> ms last admitted
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

export const MAX_TILE_ROTATION_DEG = 8;

export function makeTile(photo: Photo, config: MotionConfig, now: number, rng: Rng): Tile {
  const motion = pickWeighted(config.motionWeights, rng);
  const enter = pickWeighted(config.enterWeights, rng);
  const leave = pickWeighted(config.leaveWeights, rng);
  const size = computeSize(config.baseSize, config.sizeVariance, rng);
  const x = rng();
  const y = rng();
  // Resting tilt is a small signed angle in the admin-configured [min,max] range,
  // so photos sit at a slight angle but always upright (never spun/inverted).
  const rotation = config.tiltMinDeg + rng() * (config.tiltMaxDeg - config.tiltMinDeg);
  const dwellMs = config.dwell.enabled
    ? config.dwell.durationMs + (rng() * 2 - 1) * config.dwell.varianceMs
    : Infinity;
  return { photo, motion, enter, leave, size, x, y, rotation, bornAt: now, dwellMs, leaving: false };
}

// ---- Collision-aware placement -------------------------------------------------
// New photos are placed where they don't cover existing ones. Placement math runs
// in a normalized [0,1] square against a reference canvas (matching the renderer's
// x/y → safe-band mapping closely enough to spread tiles apart in practice).
const PLACE_REF_W = 1920;
const PLACE_REF_H = 1080;
const PLACE_CANDIDATES = 32;

interface Rect { l: number; t: number; r: number; b: number }

function tileFrac(t: Tile): { w: number; h: number } {
  const w = Math.min(1, t.size / PLACE_REF_W);
  const aspect = t.photo.width > 0 && t.photo.height > 0 ? t.photo.height / t.photo.width : 1;
  const h = Math.min(1, (t.size * aspect) / PLACE_REF_H);
  return { w, h };
}

function rectAt(x: number, y: number, w: number, h: number): Rect {
  const l = x * (1 - w);
  const t = y * (1 - h);
  return { l, t, r: l + w, b: t + h };
}

function rectOf(tile: Tile): Rect {
  const { w, h } = tileFrac(tile);
  return rectAt(tile.x, tile.y, w, h);
}

function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l));
  const oy = Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  return ox * oy;
}

function centerDist(a: Rect, b: Rect): number {
  const dx = (a.l + a.r) / 2 - (b.l + b.r) / 2;
  const dy = (a.t + a.b) / 2 - (b.t + b.b) / 2;
  return Math.hypot(dx, dy);
}

/**
 * Choose an on-canvas position (normalized x/y) for a newly admitted tile:
 *  1. Prefer a spot that overlaps NOTHING; among those, the one with the most
 *     empty space around it (largest distance to its nearest neighbour).
 *  2. If every candidate overlaps, pick the one with the least overlap — weighted
 *     so that covering NEWER photos is penalised far more than covering OLDER ones
 *     (a freshly-arrived photo should not be hidden by the next arrival).
 */
export function placeTile(existing: Tile[], newTile: Tile, rng: Rng): { x: number; y: number } {
  if (existing.length === 0) return { x: newTile.x, y: newTile.y };

  const { w, h } = tileFrac(newTile);
  // Oldest first -> weight 1; newest -> highest weight (most expensive to cover).
  const sorted = [...existing].sort((a, b) => a.bornAt - b.bornAt);
  const weighted = sorted.map((tile, i) => ({ rect: rectOf(tile), weight: i + 1 }));

  let best = { x: newTile.x, y: newTile.y };
  let bestEmptyGap = -Infinity; // for zero-overlap candidates: maximize this
  let bestCost = Infinity; // for overlapping candidates: minimize this
  let foundEmpty = false;

  for (let i = 0; i < PLACE_CANDIDATES; i += 1) {
    const x = rng();
    const y = rng();
    const cand = rectAt(x, y, w, h);

    let cost = 0;
    let nearest = Infinity;
    for (const e of weighted) {
      cost += overlapArea(cand, e.rect) * e.weight;
      nearest = Math.min(nearest, centerDist(cand, e.rect));
    }

    if (cost === 0) {
      foundEmpty = true;
      if (nearest > bestEmptyGap) {
        bestEmptyGap = nearest;
        best = { x, y };
      }
    } else if (!foundEmpty && cost < bestCost) {
      bestCost = cost;
      best = { x, y };
    }
  }

  return best;
}

export function enqueueUpload(state: EngineState, photo: Photo): EngineState {
  const inAlbum = state.album.some((p) => p.id === photo.id);
  const album = inAlbum ? state.album : [...state.album, photo];

  const onCanvas = state.onCanvas.some((t) => t.photo.id === photo.id);
  const inQueue = state.queue.some((p) => p.id === photo.id);
  const queue = onCanvas || inQueue ? state.queue : [photo, ...state.queue];

  return { ...state, queue, album };
}

export const LEAVE_GRACE_MS = 1200;

export function createEngineState(album: Photo[], config: MotionConfig): EngineState {
  return { onCanvas: [], queue: [], album: [...album], config, leftAt: {}, lastShownAt: {} };
}

function markLeaving(
  onCanvas: Tile[],
  leftAt: Record<string, number>,
  tile: Tile,
  now: number,
): { onCanvas: Tile[]; leftAt: Record<string, number> } {
  const nextOnCanvas = onCanvas.map((t) => (t === tile ? { ...t, leaving: true } : t));
  const nextLeftAt = { ...leftAt, [tile.photo.id]: now };
  return { onCanvas: nextOnCanvas, leftAt: nextLeftAt };
}

export function tick(state: EngineState, now: number, rng: Rng): EngineState {
  let onCanvas = state.onCanvas;
  let leftAt = state.leftAt;
  let lastShownAt = state.lastShownAt;
  let queue = state.queue;
  const { config } = state;

  // 1. Remove fully-left tiles (leave grace elapsed) and prune their leftAt entries
  //    so leftAt only ever holds ids of tiles still on canvas AND leaving (no leak
  //    over a long-running display where photos cycle out indefinitely).
  const removedIds = new Set(
    onCanvas
      .filter(
        (t) =>
          t.leaving &&
          leftAt[t.photo.id] !== undefined &&
          now - leftAt[t.photo.id] >= LEAVE_GRACE_MS,
      )
      .map((t) => t.photo.id),
  );
  if (removedIds.size) {
    onCanvas = onCanvas.filter((t) => !removedIds.has(t.photo.id));
    leftAt = Object.fromEntries(
      Object.entries(leftAt).filter(([id]) => !removedIds.has(id)),
    );
  }

  // 2. Mark dwell-expired non-leaving tiles leaving.
  for (const t of onCanvas) {
    if (!t.leaving && t.dwellMs !== Infinity && now - t.bornAt >= t.dwellMs) {
      const r = markLeaving(onCanvas, leftAt, t, now);
      onCanvas = r.onCanvas;
      leftAt = r.leftAt;
    }
  }

  const onCanvasIds = () => new Set(onCanvas.map((t) => t.photo.id));
  const nonLeaving = () => onCanvas.filter((t) => !t.leaving);

  // Pick which on-canvas tile to evict: prefer the oldest NON-priority tile so
  // host-favorited photos stay on screen longer. Only evict a priority tile if
  // every candidate is priority.
  const oldestEvictable = (): Tile | undefined => {
    const candidates = nonLeaving();
    if (candidates.length === 0) return undefined;
    const byAge = [...candidates].sort((a, b) => a.bornAt - b.bornAt);
    return byAge.find((t) => !t.photo.isPriority) ?? byAge[0];
  };

  // helper: distinct album photos not currently on canvas (any state) or queued
  const distinctAvailable = () => {
    const present = onCanvasIds();
    const queued = new Set(queue.map((p) => p.id));
    return state.album.filter((p) => !present.has(p.id) && !queued.has(p.id));
  };

  // A queued upload that is not already on canvas demands a slot (priority entry).
  const queuedWaiting = () => {
    const present = onCanvasIds();
    return queue.some((p) => !present.has(p.id));
  };

  // 3. Mark oldest non-leaving leaving while over cap OR while an upload demands a slot.
  //    Cap-shrink: if non-leaving exceeds cap, always evict oldest down to cap.
  //    Demand: a queued (priority) upload and a full canvas -> evict oldest to free a slot.
  //    Idle album cycling never force-evicts here; it rotates only via dwell expiry,
  //    filling slots that natural rotation frees (avoids unbounded churn / growth).
  while (nonLeaving().length > config.maxOnCanvas) {
    const oldest = oldestEvictable();
    if (!oldest) break;
    const r = markLeaving(onCanvas, leftAt, oldest, now);
    onCanvas = r.onCanvas;
    leftAt = r.leftAt;
  }
  if (queuedWaiting() && nonLeaving().length >= config.maxOnCanvas) {
    const oldest = oldestEvictable();
    if (oldest) {
      const r = markLeaving(onCanvas, leftAt, oldest, now);
      onCanvas = r.onCanvas;
      leftAt = r.leftAt;
    }
  }

  // 4. Admit from queue (priority) then album-cycle (least-recently-shown), up to cap.
  // Note: lastShownAt is bounded by album size (one entry per distinct photo ever
  // shown), so it is intentionally NOT pruned — unlike leftAt, which is pruned above.
  const admit = (photo: Photo) => {
    let tile = makeTile(photo, config, now, rng);
    // Place the new tile where it covers existing photos the least (preferring
    // empty space; covering the oldest first when overlap is unavoidable).
    if (onCanvas.length > 0) {
      const { x, y } = placeTile(onCanvas, tile, rng);
      tile = { ...tile, x, y };
    }
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
      // Host-favorited photos are admitted first so they appear on the canvas
      // more often (and, having cycled out, return soonest).
      const pa = a.isPriority ? 1 : 0;
      const pb = b.isPriority ? 1 : 0;
      if (pa !== pb) return pb - pa; // priority first
      const la = lastShownAt[a.id] ?? -Infinity;
      const lb = lastShownAt[b.id] ?? -Infinity;
      if (la !== lb) return la - lb; // least-recently-shown first
      return state.album.indexOf(a) - state.album.indexOf(b); // stable tiebreak
    });
    admit(candidates[0]);
  }

  return { ...state, onCanvas, queue, leftAt, lastShownAt };
}

/**
 * Apply a server-side photo update (e.g. a priority/favorite toggle) to every
 * place the photo lives: the album pool, the pending queue, and any on-canvas
 * tile's `photo`. Unknown photos are ignored. Re-weighting then takes effect on
 * the next tick (priority photos cycle in sooner and are evicted later).
 */
export function updatePhoto(state: EngineState, photo: Photo): EngineState {
  const album = state.album.map((p) => (p.id === photo.id ? photo : p));
  const queue = state.queue.map((p) => (p.id === photo.id ? photo : p));
  const onCanvas = state.onCanvas.map((t) =>
    t.photo.id === photo.id ? { ...t, photo } : t,
  );
  return { ...state, album, queue, onCanvas };
}

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
