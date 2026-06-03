import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MOTION_CONFIG,
  DEFAULT_MEDIA_LIMITS,
  DEFAULT_THEME_ID,
  SETTINGS_KEYS,
} from '../index.js';

describe('DEFAULT_MOTION_CONFIG', () => {
  it('has all four motion weights as positive numbers', () => {
    const w = DEFAULT_MOTION_CONFIG.motionWeights;
    expect(Object.keys(w).sort()).toEqual(['current', 'drift', 'mosaic', 'orbit']);
    for (const v of Object.values(w)) {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThan(0);
    }
  });

  it('weights sum to the expected total (5+2+1+2 = 10)', () => {
    const sum = Object.values(DEFAULT_MOTION_CONFIG.motionWeights).reduce((a, b) => a + b, 0);
    expect(sum).toBe(10);
  });

  it('has all five enter-animation weights', () => {
    expect(Object.keys(DEFAULT_MOTION_CONFIG.enterWeights).sort()).toEqual(
      ['dropBounce', 'fadeGrow', 'flyInEdge', 'scalePop', 'spinIn'],
    );
  });

  it('has all four leave-animation weights', () => {
    expect(Object.keys(DEFAULT_MOTION_CONFIG.leaveWeights).sort()).toEqual(
      ['driftOffEdge', 'shrinkFade', 'slideAway', 'spinOut'],
    );
  });

  it('has sensible scalar defaults', () => {
    expect(DEFAULT_MOTION_CONFIG.speed).toBe(1);
    expect(DEFAULT_MOTION_CONFIG.maxOnCanvas).toBe(24);
    expect(DEFAULT_MOTION_CONFIG.baseSize).toBe(220);
    expect(DEFAULT_MOTION_CONFIG.sizeVariance).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_MOTION_CONFIG.sizeVariance).toBeLessThanOrEqual(1);
  });

  it('has dwell enabled by default with duration and variance', () => {
    expect(DEFAULT_MOTION_CONFIG.dwell.enabled).toBe(true);
    expect(DEFAULT_MOTION_CONFIG.dwell.durationMs).toBe(45000);
    expect(DEFAULT_MOTION_CONFIG.dwell.varianceMs).toBe(15000);
  });
});

describe('DEFAULT_MEDIA_LIMITS', () => {
  it('matches the documented caps', () => {
    expect(DEFAULT_MEDIA_LIMITS.photoMaxBytes).toBe(25 * 1024 * 1024);
    expect(DEFAULT_MEDIA_LIMITS.videoMaxBytes).toBe(60 * 1024 * 1024);
    expect(DEFAULT_MEDIA_LIMITS.videoMaxDurationSec).toBe(30);
  });
});

describe('constants', () => {
  it('default theme id is midnight gala', () => {
    expect(DEFAULT_THEME_ID).toBe('preset-midnight-gala');
  });

  it('settings keys are snake_case strings', () => {
    expect(SETTINGS_KEYS.publicBaseUrl).toBe('public_base_url');
    expect(SETTINGS_KEYS.adminPasswordHash).toBe('admin_password_hash');
    expect(SETTINGS_KEYS.mediaLimits).toBe('media_limits');
    expect(SETTINGS_KEYS.sessionSecret).toBe('session_secret');
  });
});
