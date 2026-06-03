import { describe, it, expect } from 'vitest';
import type { MediaLimits } from '../api/types';
import { validateFiles } from './validateUpload';

const limits: MediaLimits = {
  photoMaxBytes: 25 * 1024 * 1024,
  videoMaxBytes: 60 * 1024 * 1024,
  videoMaxDurationSec: 30,
};

function fileOfSize(name: string, type: string, bytes: number): File {
  const f = new File([new Uint8Array(0)], name, { type });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

describe('validateFiles', () => {
  it('accepts an image at the exact photo size cap', () => {
    const f = fileOfSize('a.jpg', 'image/jpeg', limits.photoMaxBytes);
    const { accepted, rejected } = validateFiles([f], limits);
    expect(accepted).toEqual([f]);
    expect(rejected).toEqual([]);
  });

  it('rejects an image one byte over the photo cap with reason "too-large"', () => {
    const f = fileOfSize('a.jpg', 'image/jpeg', limits.photoMaxBytes + 1);
    const { accepted, rejected } = validateFiles([f], limits);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ file: f, reason: 'too-large' }]);
  });

  it('accepts a video at the exact video size cap', () => {
    const f = fileOfSize('v.mp4', 'video/mp4', limits.videoMaxBytes);
    const { accepted } = validateFiles([f], limits);
    expect(accepted).toEqual([f]);
  });

  it('rejects a video over the video cap', () => {
    const f = fileOfSize('v.mp4', 'video/mp4', limits.videoMaxBytes + 1);
    const { rejected } = validateFiles([f], limits);
    expect(rejected).toEqual([{ file: f, reason: 'too-large' }]);
  });

  it('rejects unsupported types with reason "bad-type"', () => {
    const f = fileOfSize('note.pdf', 'application/pdf', 10);
    const { accepted, rejected } = validateFiles([f], limits);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ file: f, reason: 'bad-type' }]);
  });

  it('partitions a mixed batch', () => {
    const ok = fileOfSize('ok.jpg', 'image/jpeg', 1000);
    const big = fileOfSize('big.jpg', 'image/jpeg', limits.photoMaxBytes + 1);
    const bad = fileOfSize('x.txt', 'text/plain', 5);
    const { accepted, rejected } = validateFiles([ok, big, bad], limits);
    expect(accepted).toEqual([ok]);
    expect(rejected).toEqual([
      { file: big, reason: 'too-large' },
      { file: bad, reason: 'bad-type' },
    ]);
  });
});
