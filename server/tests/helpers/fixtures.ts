import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Pre-register lavfi as a demuxable format in fluent-ffmpeg's cache.
 *
 * fluent-ffmpeg discovers formats via `ffmpeg -formats`, but the lavfi virtual
 * device is listed with an extra flag column (` D d lavfi …`) that its regex
 * `/^\s*([D ])([E ])\s+/` does not match, so lavfi never ends up in the cache
 * and the capability check throws "Input format lavfi is not available".
 *
 * lavfi IS fully functional in ffmpeg-static; we just need to tell fluent-ffmpeg
 * it's there before we call `.inputFormat('lavfi')`.
 */
function warmLavfiCache(): Promise<void> {
  return new Promise((resolve, reject) =>
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
}

/** Generate a solid-color JPEG buffer of the given pixel dimensions. */
export async function makeJpegBuffer(width = 1200, height = 800): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 64, g: 128, b: 200 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Generate a small PNG buffer (used for non-jpeg image-type tests). */
export async function makePngBuffer(width = 100, height = 100): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/** Create a fresh OS temp directory and return its absolute path. */
export async function makeTmpDir(prefix = 'rtpa-test-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Generate a tiny silent H.264 MP4 of `durationSec` seconds at 160x120 into `dir`.
 * Uses ffmpeg's testsrc synthetic source so no input asset is needed.
 */
export async function makeTinyMp4(dir: string, durationSec = 1): Promise<string> {
  await warmLavfiCache();
  const outPath = path.join(dir, `src-${Date.now()}.mp4`);
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`testsrc=duration=${durationSec}:size=160x120:rate=15`)
      .inputFormat('lavfi')
      .outputOptions(['-pix_fmt', 'yuv420p'])
      .videoCodec('libx264')
      .duration(durationSec)
      .save(outPath)
      .on('end', () => resolve(outPath))
      .on('error', (err) => reject(err));
  });
}

/** Read a generated mp4 into a Buffer (for multipart upload tests). */
export async function makeMp4Buffer(durationSec = 1): Promise<{ buffer: Buffer; tmpDir: string }> {
  const dir = await makeTmpDir();
  const p = await makeTinyMp4(dir, durationSec);
  const buffer = await fs.readFile(p);
  return { buffer, tmpDir: dir };
}

/** Recursively remove temp directories created during a test run. */
export async function cleanupTmp(dirs: string[]): Promise<void> {
  await Promise.all(
    dirs.map((d) => fs.rm(d, { recursive: true, force: true }).catch(() => undefined)),
  );
}
