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
  const rotation = (rng() * 2 - 1) * MAX_TILE_ROTATION_DEG;
  const dwellMs = config.dwell.enabled
    ? config.dwell.durationMs + (rng() * 2 - 1) * config.dwell.varianceMs
    : Infinity;
  return { photo, motion, enter, leave, size, x, y, rotation, bornAt: now, dwellMs, leaving: false };
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
    const oldest = [...nonLeaving()].sort((a, b) => a.bornAt - b.bornAt)[0];
    const r = markLeaving(onCanvas, leftAt, oldest, now);
    onCanvas = r.onCanvas;
    leftAt = r.leftAt;
  }
  if (queuedWaiting() && nonLeaving().length >= config.maxOnCanvas) {
    const oldest = [...nonLeaving()].sort((a, b) => a.bornAt - b.bornAt)[0];
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
      if (la !== lb) return la - lb; // least-recently-shown first
      return state.album.indexOf(a) - state.album.indexOf(b); // stable tiebreak
    });
    admit(candidates[0]);
  }

  return { ...state, onCanvas, queue, leftAt, lastShownAt };
}
