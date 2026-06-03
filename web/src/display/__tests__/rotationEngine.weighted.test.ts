import { describe, it, expect } from 'vitest';
import { pickWeighted, computeSize } from '../rotationEngine';
import type { Rng } from '../rotationEngine';

// Stub rng that returns a fixed sequence, looping.
function seqRng(values: number[]): Rng {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v;
  };
}

describe('pickWeighted', () => {
  it('maps draw bands to keys deterministically', () => {
    const weights = { a: 1, b: 2, c: 1 }; // total 4 -> a:[0,.25) b:[.25,.75) c:[.75,1)
    expect(pickWeighted(weights, seqRng([0]))).toBe('a');
    expect(pickWeighted(weights, seqRng([0.2]))).toBe('a');
    expect(pickWeighted(weights, seqRng([0.25]))).toBe('b');
    expect(pickWeighted(weights, seqRng([0.74]))).toBe('b');
    expect(pickWeighted(weights, seqRng([0.75]))).toBe('c');
    expect(pickWeighted(weights, seqRng([0.999]))).toBe('c');
  });

  it('never returns a zero-weight key', () => {
    const weights = { a: 0, b: 1, c: 0 };
    for (let d = 0; d < 100; d += 1) {
      expect(pickWeighted(weights, seqRng([d / 100]))).toBe('b');
    }
  });

  it('returns first key when all weights are zero', () => {
    expect(pickWeighted({ a: 0, b: 0 }, seqRng([0.5]))).toBe('a');
  });
});

describe('computeSize', () => {
  it('returns base when variance is 0', () => {
    expect(computeSize(200, 0, seqRng([0.5]))).toBe(200);
  });

  it('maps rng across [base*(1-variance), base*(1+variance)]', () => {
    expect(computeSize(200, 0.4, seqRng([0]))).toBeCloseTo(120);   // 200*0.6
    expect(computeSize(200, 0.4, seqRng([1]))).toBeCloseTo(280);   // 200*1.4
    expect(computeSize(200, 0.4, seqRng([0.5]))).toBeCloseTo(200);
  });

  it('stays within bounds for arbitrary draws', () => {
    for (let d = 0; d <= 10; d += 1) {
      const s = computeSize(220, 0.4, seqRng([d / 10]));
      expect(s).toBeGreaterThanOrEqual(220 * 0.6 - 1e-9);
      expect(s).toBeLessThanOrEqual(220 * 1.4 + 1e-9);
    }
  });
});
