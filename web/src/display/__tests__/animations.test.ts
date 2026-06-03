import { describe, it, expect } from 'vitest';
import { enterVariant, leaveVariant } from '../animations';
import type { EnterAnimation, LeaveAnimation } from '@rtpa/shared';

const enters: EnterAnimation[] = ['flyInEdge', 'scalePop', 'fadeGrow', 'spinIn', 'dropBounce'];
const leaves: LeaveAnimation[] = ['driftOffEdge', 'shrinkFade', 'spinOut', 'slideAway'];

describe('enterVariant', () => {
  it('returns initial/animate/transition for every enter key', () => {
    for (const key of enters) {
      const v = enterVariant(key);
      expect(v.initial).toBeTypeOf('object');
      expect(v.animate).toBeTypeOf('object');
      expect(v.transition).toBeTypeOf('object');
      // opacity resolves to fully visible in animate
      expect(v.animate.opacity).toBe(1);
    }
  });
});

describe('leaveVariant', () => {
  it('returns an exit object for every leave key', () => {
    for (const key of leaves) {
      const v = leaveVariant(key);
      expect(v.exit).toBeTypeOf('object');
    }
  });
});
