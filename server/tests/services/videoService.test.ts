import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { probeVideo, processVideo } from '../../src/services/videoService.js';
import { makeTmpDir, makeTinyMp4, cleanupTmp } from '../helpers/fixtures.js';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

/** Generate a synthetic mp4 of an arbitrary size (longest-edge clamp coverage). */
async function makeSizedMp4(dir: string, durationSec: number, size: string): Promise<string> {
  await new Promise<void>((resolve, reject) =>
    ffmpeg.getAvailableFormats((err, fmts) => {
      if (err) return reject(err);
      if (!fmts['lavfi']) {
        fmts['lavfi'] = {
          description: 'Libavfilter virtual input device',
          canDemux: true,
          canMux: false,
        };
      }
      resolve();
    }),
  );
  const outPath = path.join(dir, `sized-${Date.now()}.mp4`);
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`testsrc=duration=${durationSec}:size=${size}:rate=15`)
      .inputFormat('lavfi')
      .outputOptions(['-pix_fmt', 'yuv420p'])
      .videoCodec('libx264')
      .duration(durationSec)
      .save(outPath)
      .on('end', () => resolve(outPath))
      .on('error', (e) => reject(e));
  });
}

describe('videoService', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await cleanupTmp(dirs);
  });

  it('probeVideo reports duration and dimensions', async () => {
    const src = await makeTmpDir();
    dirs.push(src);
    const p = await makeTinyMp4(src, 1);
    const info = await probeVideo(p);
    expect(info.width).toBe(160);
    expect(info.height).toBe(120);
    expect(info.durationMs).toBeGreaterThan(700);
    expect(info.durationMs).toBeLessThan(1500);
  });

  it('processVideo transcodes display mp4 + poster thumb and caps duration', async () => {
    const src = await makeTmpDir();
    const dataDir = await makeTmpDir();
    dirs.push(src, dataDir);
    // 3s source, but cap at 1s
    const p = await makeTinyMp4(src, 3);
    const result = await processVideo(p, 'photo-vid-1', dataDir, 1);

    expect(result.displayPath).toBe(path.join(dataDir, 'media', 'display', 'photo-vid-1.mp4'));
    expect(result.thumbPath).toBe(path.join(dataDir, 'media', 'thumb', 'photo-vid-1.jpg'));
    await expect(fs.stat(result.displayPath)).resolves.toBeDefined();
    await expect(fs.stat(result.thumbPath)).resolves.toBeDefined();

    // display mp4 is non-empty
    const displayStat = await fs.stat(result.displayPath);
    expect(displayStat.size).toBeGreaterThan(0);

    // duration capped to ~1s (source was 3s)
    expect(result.durationMs).toBeLessThanOrEqual(1300);

    // display stream is H.264
    const displayProbe = await probeVideo(result.displayPath);
    expect(displayProbe.codec).toBe('h264');
    expect(displayProbe.pixelFormat).toBe('yuv420p');

    // poster is a real jpeg, longest edge <= 480
    const tmeta = await sharp(result.thumbPath).metadata();
    expect(tmeta.format).toBe('jpeg');
    expect(Math.max(tmeta.width!, tmeta.height!)).toBeLessThanOrEqual(480);

    // display longest edge <= 1280
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1280);
  }, 60000);

  it('processVideo clamps a large source to <= 1280 longest edge', async () => {
    const src = await makeTmpDir();
    const dataDir = await makeTmpDir();
    dirs.push(src, dataDir);
    // 1920x1080 synthetic 1s clip
    const p = await makeSizedMp4(src, 1, '1920x1080');
    const result = await processVideo(p, 'photo-vid-big', dataDir, 5);

    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1280);
    // aspect preserved: longest edge should land on 1280
    expect(Math.max(result.width, result.height)).toBe(1280);
    // even dims required by yuv420p
    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
  }, 60000);
});
