import { describe, it, expect } from 'vitest';
import { generateUniqueCode } from '../eventCode.js';

describe('generateUniqueCode', () => {
  it('returns a 6-char lowercase alphanumeric code', () => {
    const stub = { codeExists: () => false };
    const code = generateUniqueCode(stub);
    expect(code).toMatch(/^[0-9a-z]{6}$/);
  });

  it('retries when codeExists returns true, then succeeds', () => {
    let calls = 0;
    const stub = {
      codeExists: () => {
        calls += 1;
        return calls < 3; // first two collide, third is free
      },
    };
    const code = generateUniqueCode(stub);
    expect(code).toMatch(/^[0-9a-z]{6}$/);
    expect(calls).toBe(3);
  });

  it('throws after exhausting retries', () => {
    const stub = { codeExists: () => true };
    expect(() => generateUniqueCode(stub)).toThrow();
  });
});
