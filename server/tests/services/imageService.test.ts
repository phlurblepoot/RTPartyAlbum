import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { processImage, isHeic } from '../../src/services/imageService.js';
import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

function ftyp(brand: string): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp' + brand)]);
}

describe('imageService.processImage', () => {
  const dirs: string[] = [];
  afterAll(async () => { await cleanupTmp(dirs); });

  it('writes display + thumb jpegs and returns dimensions', async () => {
    const dataDir = await makeTmpDir();
    dirs.push(dataDir);
    const input = await makeJpegBuffer(2400, 1600); // larger than display cap
    const result = await processImage(input, 'photo-img-1', dataDir);

    expect(result.displayPath).toBe(path.join(dataDir, 'media', 'display', 'photo-img-1.jpg'));
    expect(result.thumbPath).toBe(path.join(dataDir, 'media', 'thumb', 'photo-img-1.jpg'));
    await expect(fs.stat(result.displayPath)).resolves.toBeDefined();
    await expect(fs.stat(result.thumbPath)).resolves.toBeDefined();

    // display fit inside 1600x1600 -> longest edge clamped
    const dmeta = await sharp(result.displayPath).metadata();
    expect(dmeta.format).toBe('jpeg');
    expect(Math.max(dmeta.width!, dmeta.height!)).toBeLessThanOrEqual(1600);

    // thumb fit inside 480x480
    const tmeta = await sharp(result.thumbPath).metadata();
    expect(Math.max(tmeta.width!, tmeta.height!)).toBeLessThanOrEqual(480);

    // returned width/height are the DISPLAY dims
    expect(result.width).toBe(dmeta.width);
    expect(result.height).toBe(dmeta.height);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('does not enlarge images smaller than the caps', async () => {
    const dataDir = await makeTmpDir();
    dirs.push(dataDir);
    const input = await makeJpegBuffer(300, 200);
    const result = await processImage(input, 'photo-img-2', dataDir);
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it('detects HEIC/HEIF still-image brands (routed to the WASM decoder)', () => {
    expect(isHeic(ftyp('heic'))).toBe(true);
    expect(isHeic(ftyp('heix'))).toBe(true);
    expect(isHeic(ftyp('mif1'))).toBe(true);
    expect(isHeic(ftyp('msf1'))).toBe(true);
    // non-HEIC inputs pass straight to sharp
    expect(isHeic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false); // jpeg
    expect(isHeic(ftyp('mp42'))).toBe(false); // mp4 video
    expect(isHeic(ftyp('avif'))).toBe(false); // avif decodes in sharp directly
  });

  it('rejects on input that is not a decodable image', async () => {
    const dataDir = await makeTmpDir();
    dirs.push(dataDir);
    await expect(
      processImage(Buffer.from('notanimage'), 'pX', dataDir),
    ).rejects.toThrow();
  });
});
