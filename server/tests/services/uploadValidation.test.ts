import { describe, it, expect } from 'vitest';
import {
  validateUpload,
  UploadValidationError,
} from '../../src/services/uploadValidation.js';
import type { MediaLimits } from '@rtpa/shared';

const limits: MediaLimits = {
  photoMaxBytes: 1000,
  videoMaxBytes: 2000,
  videoMaxDurationSec: 30,
};

// Minimal magic-byte buffers.
const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// ISO-BMFF 'ftyp' box for mp4: bytes 4-7 == 'ftyp'
const mp4Magic = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypmp42'),
]);
const textMagic = Buffer.from('hello world this is not media');

function pad(buf: Buffer, size: number): Buffer {
  if (buf.length >= size) return buf.subarray(0, size);
  return Buffer.concat([buf, Buffer.alloc(size - buf.length, 0)]);
}

describe('validateUpload', () => {
  it('accepts a jpeg within the photo cap', () => {
    const r = validateUpload({
      buffer: pad(jpegMagic, 500),
      mimetype: 'image/jpeg',
      sizeBytes: 500,
      limits,
    });
    expect(r.mediaType).toBe('image');
    expect(r.ext).toBe('.jpg');
  });

  it('accepts a png and maps ext to .png', () => {
    const r = validateUpload({
      buffer: pad(pngMagic, 400),
      mimetype: 'image/png',
      sizeBytes: 400,
      limits,
    });
    expect(r.mediaType).toBe('image');
    expect(r.ext).toBe('.png');
  });

  it('accepts an mp4 within the video cap', () => {
    const r = validateUpload({
      buffer: pad(mp4Magic, 1500),
      mimetype: 'video/mp4',
      sizeBytes: 1500,
      limits,
    });
    expect(r.mediaType).toBe('video');
    expect(r.ext).toBe('.mp4');
  });

  it('rejects a photo over the photo cap', () => {
    expect(() =>
      validateUpload({
        buffer: pad(jpegMagic, 1001),
        mimetype: 'image/jpeg',
        sizeBytes: 1001,
        limits,
      }),
    ).toThrow(UploadValidationError);
  });

  it('accepts a photo exactly at the cap (boundary)', () => {
    const r = validateUpload({
      buffer: pad(jpegMagic, 1000),
      mimetype: 'image/jpeg',
      sizeBytes: 1000,
      limits,
    });
    expect(r.mediaType).toBe('image');
  });

  it('rejects a video over the video cap', () => {
    expect(() =>
      validateUpload({
        buffer: pad(mp4Magic, 2001),
        mimetype: 'video/mp4',
        sizeBytes: 2001,
        limits,
      }),
    ).toThrow(UploadValidationError);
  });

  it('rejects a non-media file by magic bytes even if mime claims image', () => {
    expect(() =>
      validateUpload({
        buffer: pad(textMagic, 100),
        mimetype: 'image/jpeg',
        sizeBytes: 100,
        limits,
      }),
    ).toThrow(UploadValidationError);
  });

  it('rejects a disallowed mime type', () => {
    expect(() =>
      validateUpload({
        buffer: pad(jpegMagic, 100),
        mimetype: 'application/pdf',
        sizeBytes: 100,
        limits,
      }),
    ).toThrow(UploadValidationError);
  });
});
