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
    isPriority: false,
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
