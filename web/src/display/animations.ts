import type { EnterAnimation, LeaveAnimation } from '@rtpa/shared';

export interface EnterVariant {
  initial: Record<string, unknown>;
  animate: Record<string, unknown>;
  transition: Record<string, unknown>;
}
export interface LeaveVariant {
  exit: Record<string, unknown>;
}

export function enterVariant(key: EnterAnimation): EnterVariant {
  switch (key) {
    case 'flyInEdge':
      return {
        initial: { opacity: 0, x: -120, y: -60 },
        animate: { opacity: 1, x: 0, y: 0 },
        transition: { type: 'spring', stiffness: 120, damping: 16 },
      };
    case 'scalePop':
      return {
        initial: { opacity: 0, scale: 0.2 },
        animate: { opacity: 1, scale: 1 },
        transition: { type: 'spring', stiffness: 260, damping: 18 },
      };
    case 'fadeGrow':
      return {
        initial: { opacity: 0, scale: 0.85 },
        animate: { opacity: 1, scale: 1 },
        transition: { duration: 0.7, ease: 'easeOut' },
      };
    case 'spinIn':
      return {
        initial: { opacity: 0, rotate: -180, scale: 0.5 },
        animate: { opacity: 1, rotate: 0, scale: 1 },
        transition: { type: 'spring', stiffness: 140, damping: 14 },
      };
    case 'dropBounce':
      return {
        initial: { opacity: 0, y: -200 },
        animate: { opacity: 1, y: 0 },
        transition: { type: 'spring', stiffness: 200, damping: 12, bounce: 0.6 },
      };
    default: {
      const _exhaustive: never = key;
      throw new Error(`unknown enter animation: ${String(_exhaustive)}`);
    }
  }
}

export function leaveVariant(key: LeaveAnimation): LeaveVariant {
  switch (key) {
    case 'driftOffEdge':
      return { exit: { opacity: 0, x: 160, y: -40, transition: { duration: 1 } } };
    case 'shrinkFade':
      return { exit: { opacity: 0, scale: 0.3, transition: { duration: 0.8 } } };
    case 'spinOut':
      return { exit: { opacity: 0, rotate: 180, scale: 0.4, transition: { duration: 0.9 } } };
    case 'slideAway':
      return { exit: { opacity: 0, y: 200, transition: { duration: 0.9 } } };
    default: {
      const _exhaustive: never = key;
      throw new Error(`unknown leave animation: ${String(_exhaustive)}`);
    }
  }
}
