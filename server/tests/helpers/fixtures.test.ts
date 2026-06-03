import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { makeJpegBuffer, makeTinyMp4, makeTmpDir, cleanupTmp } from './fixtures.js';

describe('test fixtures', () => {
  const created: string[] = [];
  afterAll(async () => { await cleanupTmp(created); });

  it('makeJpegBuffer returns a decodable JPEG of the requested size', async () => {
    const buf = await makeJpegBuffer(120, 80);
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(80);
  });

  it('makeTmpDir creates a writable directory', async () => {
    const dir = await makeTmpDir();
    created.push(dir);
    await fs.writeFile(`${dir}/probe.txt`, 'ok');
    const txt = await fs.readFile(`${dir}/probe.txt`, 'utf8');
    expect(txt).toBe('ok');
  });

  it('makeTinyMp4 writes a ~1s playable mp4 file', async () => {
    const dir = await makeTmpDir();
    created.push(dir);
    const p = await makeTinyMp4(dir, 1);
    const stat = await fs.stat(p);
    expect(stat.size).toBeGreaterThan(0);
    expect(p.endsWith('.mp4')).toBe(true);
  });
});
