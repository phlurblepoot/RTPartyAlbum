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

  it('orbit animates rotate over a full turn with x/y-matched cadence', () => {
    const p = motionPropsFor('orbit', 1);
    expect(p.animate.rotate).toEqual([0, 90, 180, 270, 360]);
    // rotate must share the x/y keyframe cadence so the tile traces a circle
    expect((p.animate.rotate as number[]).length).toBe((p.animate.x as number[]).length);
    expect((p.animate.rotate as number[]).length).toBe((p.animate.y as number[]).length);
  });

  it('scales duration inversely with speed', () => {
    const slow = motionPropsFor('drift', 0.5).transition.duration;
    const fast = motionPropsFor('drift', 2).transition.duration;
    expect(fast).toBeLessThan(slow);
  });
});
