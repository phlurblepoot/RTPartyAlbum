import type { MotionConfig, MediaLimits } from './types.js';

export const DEFAULT_MOTION_CONFIG: MotionConfig = {
  motionWeights: { drift: 5, current: 2, orbit: 1, mosaic: 2, sway: 3, bob: 3, breathe: 2 },
  speed: 1,
  maxOnCanvas: 24,
  dwell: { enabled: true, durationMs: 45000, varianceMs: 15000 },
  enterWeights: { flyInEdge: 3, scalePop: 2, fadeGrow: 2, spinIn: 1, dropBounce: 2 },
  leaveWeights: { driftOffEdge: 3, shrinkFade: 3, spinOut: 1, slideAway: 2 },
  baseSize: 220,
  sizeVariance: 0.4,
  tiltMinDeg: -8,
  tiltMaxDeg: 8,
};

export const DEFAULT_MEDIA_LIMITS: MediaLimits = {
  photoMaxBytes: 25 * 1024 * 1024,
  videoMaxBytes: 60 * 1024 * 1024,
  videoMaxDurationSec: 30,
};

export const DEFAULT_THEME_ID = 'preset-midnight-gala';
export const SETTINGS_KEYS = {
  publicBaseUrl: 'public_base_url',
  adminPasswordHash: 'admin_password_hash',
  mediaLimits: 'media_limits',
  sessionSecret: 'session_secret',
} as const;
