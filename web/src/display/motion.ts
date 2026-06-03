import type { TargetAndTransition, Transition } from 'framer-motion';
import type { MotionStyle } from '@rtpa/shared';

export interface MotionProps {
  animate: TargetAndTransition;
  transition: Transition;
}

// Base durations (seconds) at speed 1; scaled inversely by speed. Each style has a
// distinct cadence so the motions read differently even at a glance.
const BASE_DURATION: Record<MotionStyle, number> = {
  drift: 16,
  current: 22,
  orbit: 26,
  mosaic: 11,
  sway: 13,
  bob: 9,
  breathe: 8,
};

/**
 * Maximum translation (px) each motion reaches from its anchor. The renderer
 * reserves this much extra inset from the canvas edge so a gliding tile never
 * crosses it. Keep these >= the largest displacement in the keyframes below
 * (including diagonal corners and the breathe scale-up).
 */
export const MOTION_TRAVEL_PX: Record<MotionStyle, number> = {
  drift: 40, // corner of (30,-24) ≈ 38
  current: 84, // peak |x| = 80
  orbit: 56, // circle radius 52
  mosaic: 34, // corner of (22,22) ≈ 31
  sway: 46, // peak |x| = 42 + arc
  bob: 38, // peak |y| = 34
  breathe: 24, // small drift + scale headroom
};

export function motionTravelPx(style: MotionStyle): number {
  return MOTION_TRAVEL_PX[style];
}

export function motionPropsFor(style: MotionStyle, speed: number): MotionProps {
  const s = speed > 0 ? speed : 1;
  const duration = BASE_DURATION[style] / s;

  switch (style) {
    case 'drift':
      // Loose, slow diagonal wander — meanders around its anchor in no fixed direction.
      return {
        animate: { x: [0, 30, -22, 16, 0], y: [0, -24, 18, -12, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    case 'current':
      // Long, directional horizontal sweep with a slight bob — like floating downstream.
      return {
        animate: { x: [0, 80, 0, -80, 0], y: [0, 12, -12, 8, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    case 'orbit':
      // Traces a CIRCLE via phase-shifted x/y (top → right → bottom → left). The image
      // itself never rotates — rotating it would flip photos upside down — so tiles stay
      // upright while orbiting their anchor.
      return {
        animate: { x: [0, 52, 0, -52, 0], y: [-52, 0, 52, 0, -52] },
        transition: { duration, repeat: Infinity, repeatType: 'loop', ease: 'linear' },
      };
    case 'mosaic':
      // Tight, snappy grid-like steps with held beats — a distinct staccato rhythm.
      return {
        animate: { x: [0, 22, 22, 0, -22, 0], y: [0, 0, 22, 22, 0, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut', times: [0, 0.18, 0.4, 0.58, 0.8, 1] },
      };
    case 'sway':
      // Elegant pendulum: a wide, smooth side-to-side glide that dips slightly at each
      // extreme (a hanging-sign arc), without rotating the image.
      return {
        animate: { x: [-42, 0, 42, 0, -42], y: [0, -8, 0, -8, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'loop', ease: 'easeInOut' },
      };
    case 'bob':
      // Gentle vertical float — like resting on calm water, with a barely-there x lean.
      return {
        animate: { y: [0, -34, 0, 22, 0], x: [0, 5, -5, 3, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    case 'breathe':
      // Slow, elegant scale pulse with a whisper of drift — the photo "breathes".
      return {
        animate: { scale: [1, 1.06, 1], x: [0, 8, 0, -6, 0], y: [0, -6, 0, 6, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    default: {
      const _exhaustive: never = style;
      throw new Error(`unknown motion style: ${String(_exhaustive)}`);
    }
  }
}
