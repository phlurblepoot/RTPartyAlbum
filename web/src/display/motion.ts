import type { MotionStyle } from '@rtpa/shared';

export interface MotionProps {
  animate: Record<string, unknown>;
  transition: { duration: number; repeat: number; repeatType: 'mirror' | 'loop'; ease: string };
}

// Base durations (seconds) at speed 1; scaled inversely by speed.
const BASE_DURATION: Record<MotionStyle, number> = {
  drift: 18,
  current: 26,
  orbit: 30,
  mosaic: 22,
};

export function motionPropsFor(style: MotionStyle, speed: number): MotionProps {
  const s = speed > 0 ? speed : 1;
  const duration = BASE_DURATION[style] / s;

  switch (style) {
    case 'drift':
      return {
        animate: { x: [0, 14, -10, 6, 0], y: [0, -10, 8, -6, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    case 'current':
      return {
        animate: { x: [0, 40, 0], y: [0, 6, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    case 'orbit':
      return {
        animate: { rotate: [0, 90, 180, 270, 360], x: [0, 18, 0, -18, 0], y: [0, 18, 0, -18, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'loop', ease: 'easeInOut' },
      };
    case 'mosaic':
      return {
        animate: { x: [0, 8, -8, 0], y: [0, 6, -6, 0] },
        transition: { duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' },
      };
    default: {
      const _exhaustive: never = style;
      throw new Error(`unknown motion style: ${String(_exhaustive)}`);
    }
  }
}
