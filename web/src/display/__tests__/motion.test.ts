import { describe, it, expect } from 'vitest';
import { motionPropsFor, motionTravelPx } from '../motion';

const styles = ['drift', 'current', 'orbit', 'mosaic', 'sway', 'bob', 'breathe'] as const;

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

  it('orbit traces a circular path via x/y and never rotates the image (no upside-down)', () => {
    const animate = animateOf('orbit', 1);
    // The image must NOT rotate — a full-turn rotate flips photos upside down.
    expect(animate.rotate).toBeUndefined();
    // x/y keyframes share a cadence and are phase-shifted so the tile circles its anchor.
    expect(Array.isArray(animate.x)).toBe(true);
    expect(Array.isArray(animate.y)).toBe(true);
    expect((animate.x as number[]).length).toBe((animate.y as number[]).length);
  });

  it('no motion style rotates the image (keeps photos upright)', () => {
    for (const style of styles) {
      expect(animateOf(style, 1).rotate).toBeUndefined();
    }
  });

  it('exposes a positive edge-safety travel for every style', () => {
    for (const style of styles) {
      expect(motionTravelPx(style)).toBeGreaterThan(0);
    }
  });

  it('each style has its own characteristic motion (not all the same)', () => {
    // sway is primarily horizontal, bob primarily vertical, breathe scales.
    const sway = animateOf('sway', 1);
    expect(Array.isArray(sway.x)).toBe(true);
    const bob = animateOf('bob', 1);
    expect(Array.isArray(bob.y)).toBe(true);
    const breathe = animateOf('breathe', 1);
    expect(Array.isArray(breathe.scale)).toBe(true);

    // No two styles share an identical animate target (they are genuinely distinct).
    const sigs = styles.map((s) => JSON.stringify(animateOf(s, 1)));
    expect(new Set(sigs).size).toBe(styles.length);
  });

  it('scales duration inversely with speed', () => {
    const slow = transitionOf('drift', 0.5).duration as number;
    const fast = transitionOf('drift', 2).duration as number;
    expect(fast).toBeLessThan(slow);
  });
});
