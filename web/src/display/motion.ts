import type { TargetAndTransition, Transition } from 'framer-motion';
import type { MotionStyle } from '@rtpa/shared';

export interface MotionProps {
  animate: TargetAndTransition;
  transition: Transition;
}

// Base durations (seconds) at speed 1; scaled inversely by speed. Each style has a
// distinct cadence so the four motions read differently even at a glance.
const BASE_DURATION: Record<MotionStyle, number> = {
  drift: 16,
  current: 22,
  orbit: 28,
  mosaic: 12,
};

/**
 * Maximum translation (px) each motion reaches from its anchor. The renderer
 * reserves this much extra inset from the canvas edge so a gliding tile never
 * crosses it. Keep these >= the largest displacement in the keyframes below
 * (including diagonal corners, where |(x,y)| exceeds either axis alone).
 */
export const MOTION_TRAVEL_PX: Record<MotionStyle, number> = {
  drift: 34, // corner of (24,-20) ≈ 31
  current: 74, // peak |x| = 70
  orbit: 48, // circle radius 44
  mosaic: 28, // corner of (18,18) ≈ 25
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
        animate: { x: [0, 24, -18, 12, 0], y: [0, -20, 14, -10, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    case 'current':
      // Long, directional horizontal sweep with a slight bob — like floating downstream.
      return {
        animate: { x: [0, 70, 0, -70, 0], y: [0, 10, -10, 6, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    case 'orbit':
      // Traces a CIRCLE via phase-shifted x/y (top → right → bottom → left). The image
      // itself never rotates — rotating it would flip photos upside down — so tiles stay
      // upright while orbiting their anchor.
      return {
        animate: { x: [0, 44, 0, -44, 0], y: [-44, 0, 44, 0, -44] },
        transition: { duration, repeat: Infinity, repeatType: 'loop', ease: 'linear' },
      };
    case 'mosaic':
      // Tight, snappy grid-like steps with held beats — a distinct staccato rhythm.
      return {
        animate: { x: [0, 18, 18, 0, -18, 0], y: [0, 0, 18, 18, 0, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    default: {
      const _exhaustive: never = style;
      throw new Error(`unknown motion style: ${String(_exhaustive)}`);
    }
  }
}
