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
