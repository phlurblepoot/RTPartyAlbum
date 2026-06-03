import { describe, it, expect } from 'vitest';
import { motionPropsFor } from '../motion';

const styles = ['drift', 'current', 'orbit', 'mosaic'] as const;

// The returns are typed with framer-motion's union types (TargetAndTransition /
// Transition); reading specific keyframe/timing fields in tests needs a loose view.
const animateOf = (s: (typeof styles)[number], speed: number) =>
  motionPropsFor(s, speed).animate as Record<string, unknown>;
const transitionOf = (s: (typeof styles)[number], speed: number) =>
  motionPropsFor(s, speed).transition as Record<string, unknown>;

describe('motionPropsFor', () => {
  it('returns animate + transition with infinite repeat for every style', () => {
    for (const style of styles) {
      const animate = animateOf(style, 1);
      const transition = transitionOf(style, 1);
      expect(animate).toBeTypeOf('object');
      expect(transition).toBeTypeOf('object');
      expect(transition.repeat).toBe(Infinity);
      expect(transition.duration as number).toBeGreaterThan(0);
    }
  });

  it('drift/current/mosaic animate x and/or y keyframes', () => {
    expect(Array.isArray(animateOf('drift', 1).x)).toBe(true);
    expect(Array.isArray(animateOf('current', 1).x)).toBe(true);
    expect(Array.isArray(animateOf('mosaic', 1).y)).toBe(true);
  });

  it('orbit animates rotate over a full turn with x/y-matched cadence', () => {
    const animate = animateOf('orbit', 1);
    expect(animate.rotate).toEqual([0, 90, 180, 270, 360]);
    // rotate must share the x/y keyframe cadence so the tile traces a circle
    expect((animate.rotate as number[]).length).toBe((animate.x as number[]).length);
    expect((animate.rotate as number[]).length).toBe((animate.y as number[]).length);
  });

  it('scales duration inversely with speed', () => {
    const slow = transitionOf('drift', 0.5).duration as number;
    const fast = transitionOf('drift', 2).duration as number;
    expect(fast).toBeLessThan(slow);
  });
});
