# RTPartyAlbum — Plan 3: Media Upload Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete media pipeline for RTPartyAlbum: guests upload photos/videos via the public route, the server validates and processes each file (sharp for images, ffmpeg for videos), writes originals + derived display/thumb assets, persists rows via `photoRepo`, and broadcasts `photo:added` over Socket.IO. Admins can list (with private device fields), hide/unhide, and delete photos, and download the whole album as a streamed zip with a manifest. Every behavior is covered by TDD with tiny **generated** fixtures (a sharp-made JPEG, an ffmpeg-made ~1s MP4) so no binary assets are committed.

**Architecture:** Builds on **Plan 1** (db, repositories, config, `media.ts` static serving, migrations/seed) and **Plan 2** (`auth.ts`/`requireAuth`, `realtime.ts` emit helpers, `eventRepo`, `adminEvents.ts`, `publicEvents.ts` read routes). This plan adds three services (`imageService`, `videoService`, `exportService`) and one validator (`uploadValidation`), a Multer middleware, the upload handler inside `publicEvents.ts`, three admin photo routes (`adminPhotos.ts`), the export route (`adminExport.ts`), and wires them into `app.ts`. Originals are stored at `${uploadsDir}/<eventId>/<photoId><ext>`; derived assets at `${dataDir}/media/display/<photoId>.<jpg|mp4>` and `${dataDir}/media/thumb/<photoId>.jpg`, exactly per the shared contracts' "Media storage & processing rules". The `photoRepo` builds `displayUrl`/`thumbUrl` from stored filenames; this plan only writes files and rows.

**Tech Stack:** Node 20, TypeScript ^5.4 (ESM), Express ^4.19, multer ^1.4.5-lts.1, sharp ^0.33, fluent-ffmpeg ^2.1.3, ffmpeg-static ^5.2, ffprobe-static (for `ffprobe` binary), express-rate-limit ^7, archiver ^7, zod ^3.23, nanoid ^5, better-sqlite3 ^11, socket.io ^4.7. Tests: Vitest ^2 + supertest ^7, run with `tsx`. `@rtpa/shared` provides all DTO/type definitions.

---

## Conventions used by every task

- **TDD loop per step group:** write a failing test → run it and confirm it FAILS for the expected reason → write the COMPLETE implementation → run and confirm it PASSES → commit with a conventional-commit message.
- **Test commands:** server tests run via `npm test -w @rtpa/server`. Single file: `npm test -w @rtpa/server -- <path>`.
- **All new server files are ESM** (`import x from 'y.js'` for local files — note the `.js` extension on relative imports because the project is `"type": "module"` and compiled/`tsx`-run TS resolves emitted JS paths).
- **`photoId` generation:** use `nanoid()` (default 21-char). Generated once per file and reused for the original ext-named file, the display file, and the thumb file.
- **Extension from detected type:** images → original ext is `.jpg`/`.png`/`.heic`/`.webp`/`.gif` per detected subtype but stored display is always `.jpg`; videos → original ext `.mp4`/`.mov`/`.webm` per detected subtype, display always `.mp4`. The original ext is provided by `uploadValidation` (see Task 3).

---

## Task 1: Test-fixture helper (generate tiny JPEG + MP4)

A single reusable helper so no binary assets are committed. It generates a small JPEG via sharp and a ~1s silent MP4 via ffmpeg into a temp dir, returning buffers/paths. Used by every later task.

**Files:**
- `server/tests/helpers/fixtures.ts` (new)
- `server/tests/helpers/fixtures.test.ts` (new — proves the helper itself works)

Steps:

- [ ] Write failing test `server/tests/helpers/fixtures.test.ts`:
  ```ts
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
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/helpers/fixtures.test.ts` and confirm it FAILS (module not found).
- [ ] Write COMPLETE `server/tests/helpers/fixtures.ts`:
  ```ts
  import { promises as fs } from 'node:fs';
  import os from 'node:os';
  import path from 'node:path';
  import sharp from 'sharp';
  import ffmpegPath from 'ffmpeg-static';
  import ffmpeg from 'fluent-ffmpeg';

  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

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
  export function makeTinyMp4(dir: string, durationSec = 1): Promise<string> {
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
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/helpers/fixtures.test.ts` and confirm it PASSES. (If the ffmpeg `lavfi`/`testsrc` test is slow, allow up to 30s; it is generated once and reused.)
- [ ] Commit: `test(server): add generated jpeg/mp4 test-fixture helpers`

---

## Task 2: imageService — `src/services/imageService.ts`

Processes an in-memory image buffer into a 1600×1600-fit display JPEG and a 480×480-fit thumb JPEG, auto-oriented, metadata stripped except orientation, HEIC normalized to JPEG.

**Files:**
- `server/src/services/imageService.ts` (new)
- `server/tests/services/imageService.test.ts` (new)

Steps:

- [ ] Write failing test `server/tests/services/imageService.test.ts`:
  ```ts
  import { describe, it, expect, afterAll } from 'vitest';
  import { promises as fs } from 'node:fs';
  import path from 'node:path';
  import sharp from 'sharp';
  import { processImage } from '../../src/services/imageService.js';
  import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

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
    });

    it('does not enlarge images smaller than the caps', async () => {
      const dataDir = await makeTmpDir();
      dirs.push(dataDir);
      const input = await makeJpegBuffer(300, 200);
      const result = await processImage(input, 'photo-img-2', dataDir);
      expect(result.width).toBe(300);
      expect(result.height).toBe(200);
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/services/imageService.test.ts` and confirm it FAILS (module not found).
- [ ] Write COMPLETE `server/src/services/imageService.ts`:
  ```ts
  import { promises as fs } from 'node:fs';
  import path from 'node:path';
  import sharp from 'sharp';

  export interface ProcessImageResult {
    displayPath: string;
    thumbPath: string;
    width: number;
    height: number;
  }

  const DISPLAY_MAX = 1600;
  const THUMB_MAX = 480;

  /**
   * Process an in-memory image buffer into a display JPEG (fit inside 1600x1600, q82)
   * and a thumb JPEG (fit inside 480x480, q75). Auto-orients, strips all metadata
   * except orientation. HEIC and other sharp-supported formats are normalized to JPEG.
   * Returns absolute file paths plus the DISPLAY image dimensions.
   */
  export async function processImage(
    inputBuffer: Buffer,
    photoId: string,
    dataDir: string,
  ): Promise<ProcessImageResult> {
    const displayDir = path.join(dataDir, 'media', 'display');
    const thumbDir = path.join(dataDir, 'media', 'thumb');
    await fs.mkdir(displayDir, { recursive: true });
    await fs.mkdir(thumbDir, { recursive: true });

    const displayPath = path.join(displayDir, `${photoId}.jpg`);
    const thumbPath = path.join(thumbDir, `${photoId}.jpg`);

    // Display: auto-orient, strip metadata (sharp drops EXIF by default; rotate() bakes
    // orientation into pixels so we can safely strip), fit inside 1600x1600 without enlarging.
    const displayBuffer = await sharp(inputBuffer)
      .rotate() // auto-orient from EXIF, then orientation is baked in
      .resize({
        width: DISPLAY_MAX,
        height: DISPLAY_MAX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    await fs.writeFile(displayPath, displayBuffer);

    const displayMeta = await sharp(displayBuffer).metadata();

    // Thumb derived from the display buffer (already oriented + stripped).
    const thumbBuffer = await sharp(displayBuffer)
      .resize({
        width: THUMB_MAX,
        height: THUMB_MAX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 75 })
      .toBuffer();
    await fs.writeFile(thumbPath, thumbBuffer);

    return {
      displayPath,
      thumbPath,
      width: displayMeta.width ?? 0,
      height: displayMeta.height ?? 0,
    };
  }
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/services/imageService.test.ts` and confirm it PASSES.
- [ ] Commit: `feat(server): add imageService for sharp display/thumb processing`

---

## Task 3: videoService — `src/services/videoService.ts`

Probes a video for duration/dimensions and transcodes it to a length-capped H.264 yuv420p faststart MP4 (longest edge ≤1280) plus a JPEG poster frame (≤480). Uses `ffmpeg-static` for ffmpeg and `ffprobe-static` for ffprobe.

**Files:**
- `server/src/services/videoService.ts` (new)
- `server/tests/services/videoService.test.ts` (new)

Steps:

- [ ] Write failing test `server/tests/services/videoService.test.ts`:
  ```ts
  import { describe, it, expect, afterAll } from 'vitest';
  import { promises as fs } from 'node:fs';
  import path from 'node:path';
  import sharp from 'sharp';
  import { probeVideo, processVideo } from '../../src/services/videoService.js';
  import { makeTmpDir, makeTinyMp4, cleanupTmp } from '../helpers/fixtures.js';

  describe('videoService', () => {
    const dirs: string[] = [];
    afterAll(async () => { await cleanupTmp(dirs); });

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

      // duration capped to ~1s
      expect(result.durationMs).toBeLessThanOrEqual(1300);

      // poster is a real jpeg, longest edge <= 480
      const tmeta = await sharp(result.thumbPath).metadata();
      expect(tmeta.format).toBe('jpeg');
      expect(Math.max(tmeta.width!, tmeta.height!)).toBeLessThanOrEqual(480);

      // display longest edge <= 1280
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1280);
    }, 60000);
  });
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/services/videoService.test.ts` and confirm it FAILS (module not found).
- [ ] Ensure `ffprobe-static` is a dependency. If not present, add it:
  ```bash
  npm install -w @rtpa/server ffprobe-static
  ```
- [ ] Write COMPLETE `server/src/services/videoService.ts`:
  ```ts
  import { promises as fs } from 'node:fs';
  import path from 'node:path';
  import ffmpeg from 'fluent-ffmpeg';
  import ffmpegPath from 'ffmpeg-static';
  import ffprobeStatic from 'ffprobe-static';

  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
  if (ffprobeStatic?.path) ffmpeg.setFfprobePath(ffprobeStatic.path);

  export interface VideoProbe {
    durationMs: number;
    width: number;
    height: number;
  }

  export interface ProcessVideoResult {
    displayPath: string;
    thumbPath: string;
    width: number;
    height: number;
    durationMs: number;
  }

  const DISPLAY_MAX = 1280;
  const THUMB_MAX = 480;

  /** Probe a video file for duration (ms) and pixel dimensions of the first video stream. */
  export function probeVideo(inputPath: string): Promise<VideoProbe> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, data) => {
        if (err) return reject(err);
        const stream = data.streams.find((s) => s.codec_type === 'video');
        if (!stream) return reject(new Error('no video stream'));
        const durationSec =
          typeof data.format.duration === 'number'
            ? data.format.duration
            : Number.parseFloat(String(data.format.duration ?? '0'));
        resolve({
          durationMs: Math.round((Number.isFinite(durationSec) ? durationSec : 0) * 1000),
          width: stream.width ?? 0,
          height: stream.height ?? 0,
        });
      });
    });
  }

  /**
   * Transcode a video to a display MP4 (H.264, yuv420p, faststart, trimmed to
   * maxDurationSec, longest edge <= 1280) and extract a JPEG poster frame (~0.5s, <= 480).
   * Returns absolute paths plus the resulting display dimensions and (capped) duration.
   */
  export async function processVideo(
    inputPath: string,
    photoId: string,
    dataDir: string,
    maxDurationSec: number,
  ): Promise<ProcessVideoResult> {
    const displayDir = path.join(dataDir, 'media', 'display');
    const thumbDir = path.join(dataDir, 'media', 'thumb');
    await fs.mkdir(displayDir, { recursive: true });
    await fs.mkdir(thumbDir, { recursive: true });

    const displayPath = path.join(displayDir, `${photoId}.mp4`);
    const thumbPath = path.join(thumbDir, `${photoId}.jpg`);

    const source = await probeVideo(inputPath);
    const longest = Math.max(source.width, source.height);
    // scale filter: clamp longest edge to DISPLAY_MAX, preserve aspect, keep even dims.
    const scaleFilter =
      longest > DISPLAY_MAX
        ? source.width >= source.height
          ? `scale=${DISPLAY_MAX}:-2`
          : `scale=-2:${DISPLAY_MAX}`
        : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec('libx264')
        .noAudio()
        .duration(maxDurationSec)
        .videoFilters(scaleFilter)
        .outputOptions(['-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-preset', 'veryfast'])
        .save(displayPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });

    // Poster frame at ~0.5s (or 0 if shorter), scaled to fit <= 480 longest edge.
    const posterSec = Math.min(0.5, Math.max(0, source.durationMs / 1000 - 0.05));
    const posterScale =
      source.width >= source.height ? `scale=${THUMB_MAX}:-2` : `scale=-2:${THUMB_MAX}`;
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(posterSec)
        .frames(1)
        .videoFilters(posterScale)
        .outputOptions(['-q:v', '3'])
        .save(thumbPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });

    const out = await probeVideo(displayPath);
    return {
      displayPath,
      thumbPath,
      width: out.width,
      height: out.height,
      durationMs: out.durationMs,
    };
  }
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/services/videoService.test.ts` and confirm it PASSES.
- [ ] Commit: `feat(server): add videoService for ffmpeg transcode + poster`

---

## Task 4: Upload validation — `src/services/uploadValidation.ts`

Detect media type from MIME and magic bytes, enforce `MediaLimits`, reject disallowed types. Returns the resolved media type + canonical extension, or throws a typed validation error.

**Files:**
- `server/src/services/uploadValidation.ts` (new)
- `server/tests/services/uploadValidation.test.ts` (new)

Steps:

- [ ] Write failing test `server/tests/services/uploadValidation.test.ts`:
  ```ts
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
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/services/uploadValidation.test.ts` and confirm it FAILS (module not found).
- [ ] Write COMPLETE `server/src/services/uploadValidation.ts`:
  ```ts
  import type { MediaLimits, MediaType } from '@rtpa/shared';

  export class UploadValidationError extends Error {
    constructor(
      message: string,
      public readonly code:
        | 'unsupported_type'
        | 'photo_too_large'
        | 'video_too_large'
        | 'empty_file',
    ) {
      super(message);
      this.name = 'UploadValidationError';
    }
  }

  export interface ValidateUploadInput {
    buffer: Buffer;
    mimetype: string;
    sizeBytes: number;
    limits: MediaLimits;
  }

  export interface ValidateUploadResult {
    mediaType: MediaType;
    ext: string; // canonical original extension incl. leading dot
    detectedMime: string;
  }

  type Detected = { mediaType: MediaType; ext: string; mime: string } | null;

  /** Detect media type + canonical extension from magic bytes. Returns null if unknown. */
  function detectFromMagic(buf: Buffer): Detected {
    if (buf.length < 12) return null;
    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return { mediaType: 'image', ext: '.jpg', mime: 'image/jpeg' };
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
    ) {
      return { mediaType: 'image', ext: '.png', mime: 'image/png' };
    }
    // GIF: 'GIF8'
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
      return { mediaType: 'image', ext: '.gif', mime: 'image/gif' };
    }
    // RIFF....WEBP (image) -> bytes 0-3 'RIFF', 8-11 'WEBP'
    if (
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { mediaType: 'image', ext: '.webp', mime: 'image/webp' };
    }
    // ISO-BMFF 'ftyp' box at bytes 4-7 -> mp4/mov/heic share this container.
    if (buf.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buf.toString('ascii', 8, 12);
      // HEIC/HEIF brands -> treated as image, normalized to jpeg later by sharp.
      if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'heim') {
        return { mediaType: 'image', ext: '.heic', mime: 'image/heic' };
      }
      // QuickTime mov brand 'qt  '
      if (brand === 'qt  ') {
        return { mediaType: 'video', ext: '.mov', mime: 'video/quicktime' };
      }
      // Everything else with ftyp -> treat as mp4 video.
      return { mediaType: 'video', ext: '.mp4', mime: 'video/mp4' };
    }
    // WEBM / Matroska: 1A 45 DF A3
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      return { mediaType: 'video', ext: '.webm', mime: 'video/webm' };
    }
    return null;
  }

  /**
   * Validate one uploaded file. Detects real type from magic bytes (must agree with the
   * declared MIME family image/* or video/*), enforces size caps from MediaLimits, and
   * returns the resolved media type + canonical extension. Throws UploadValidationError.
   */
  export function validateUpload(input: ValidateUploadInput): ValidateUploadResult {
    const { buffer, mimetype, sizeBytes, limits } = input;

    if (sizeBytes <= 0 || buffer.length === 0) {
      throw new UploadValidationError('empty file', 'empty_file');
    }

    const detected = detectFromMagic(buffer);
    if (!detected) {
      throw new UploadValidationError('unsupported or unrecognized media type', 'unsupported_type');
    }

    // The declared mime family must match what the bytes say.
    const declaredFamily = mimetype.split('/')[0];
    if (declaredFamily !== detected.mediaType) {
      throw new UploadValidationError(
        `declared type ${mimetype} does not match detected ${detected.mime}`,
        'unsupported_type',
      );
    }

    if (detected.mediaType === 'image') {
      if (sizeBytes > limits.photoMaxBytes) {
        throw new UploadValidationError('photo exceeds size limit', 'photo_too_large');
      }
    } else {
      if (sizeBytes > limits.videoMaxBytes) {
        throw new UploadValidationError('video exceeds size limit', 'video_too_large');
      }
    }

    return { mediaType: detected.mediaType, ext: detected.ext, detectedMime: detected.mime };
  }
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/services/uploadValidation.test.ts` and confirm it PASSES.
- [ ] Commit: `feat(server): add uploadValidation (magic bytes + size caps)`

---

## Task 5: Multer middleware — `src/middleware/upload.ts`

Memory storage, per-file size cap = `max(photoMaxBytes, videoMaxBytes)`, accept `image/*` and `video/*`, multipart field `files` (array). Text fields `uploaderName`/`deviceId` ride along in `req.body`.

**Files:**
- `server/src/middleware/upload.ts` (new)
- `server/tests/middleware/upload.test.ts` (new)

Steps:

- [ ] Write failing test `server/tests/middleware/upload.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import express from 'express';
  import request from 'supertest';
  import { makeUploadMiddleware } from '../../src/middleware/upload.js';
  import { makeJpegBuffer } from '../helpers/fixtures.js';

  function appWith(maxBytes: number) {
    const app = express();
    const upload = makeUploadMiddleware(maxBytes);
    app.post('/u', upload, (req, res) => {
      const files = (req.files as Express.Multer.File[]) ?? [];
      res.json({
        count: files.length,
        uploaderName: req.body.uploaderName,
        deviceId: req.body.deviceId,
        mimetypes: files.map((f) => f.mimetype),
        sizes: files.map((f) => f.size),
      });
    });
    // error handler to surface multer errors as 413/400
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    });
    return app;
  }

  describe('upload middleware', () => {
    it('accepts multiple image files and text fields', async () => {
      const app = appWith(5 * 1024 * 1024);
      const jpeg = await makeJpegBuffer(100, 100);
      const res = await request(app)
        .post('/u')
        .field('uploaderName', 'Alice')
        .field('deviceId', 'dev-123')
        .attach('files', jpeg, 'a.jpg')
        .attach('files', jpeg, 'b.jpg');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.uploaderName).toBe('Alice');
      expect(res.body.deviceId).toBe('dev-123');
      expect(res.body.mimetypes[0]).toBe('image/jpeg');
    });

    it('rejects a non image/video mimetype', async () => {
      const app = appWith(5 * 1024 * 1024);
      const res = await request(app)
        .post('/u')
        .attach('files', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
      expect(res.status).toBe(400);
    });

    it('rejects a file larger than the per-file cap', async () => {
      const app = appWith(1024); // 1KB cap
      const jpeg = await makeJpegBuffer(400, 400); // > 1KB
      const res = await request(app).post('/u').attach('files', jpeg, 'big.jpg');
      expect(res.status).toBe(413);
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/middleware/upload.test.ts` and confirm it FAILS (module not found).
- [ ] Write COMPLETE `server/src/middleware/upload.ts`:
  ```ts
  import type { RequestHandler } from 'express';
  import multer from 'multer';

  export const UPLOAD_FIELD = 'files';
  export const UPLOAD_MAX_COUNT = 20;

  /**
   * Build the Multer middleware for the public upload route.
   * - In-memory storage (buffers handed to sharp/ffmpeg services).
   * - Per-file byte cap = max(photoMaxBytes, videoMaxBytes); finer per-type caps are
   *   enforced afterward by uploadValidation.
   * - Accepts only image/* and video/* mimetypes; field name `files` (array).
   * Text fields uploaderName/deviceId arrive on req.body automatically.
   */
  export function makeUploadMiddleware(perFileMaxBytes: number): RequestHandler {
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: perFileMaxBytes, files: UPLOAD_MAX_COUNT },
      fileFilter: (_req, file, cb) => {
        const family = file.mimetype.split('/')[0];
        if (family === 'image' || family === 'video') {
          cb(null, true);
        } else {
          cb(new Error(`unsupported mimetype: ${file.mimetype}`));
        }
      },
    });
    return upload.array(UPLOAD_FIELD, UPLOAD_MAX_COUNT);
  }
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/middleware/upload.test.ts` and confirm it PASSES.
- [ ] Commit: `feat(server): add multer upload middleware`

---

## Task 6: Upload route — modify `src/routes/publicEvents.ts`

Add `POST /api/events/by-code/:code/upload`. Rate-limited per `deviceId`+IP. Rejects if event missing/ended/`!uploadEnabled` (403). For each file: validate → route to image/video service → write original under `${uploadsDir}/<eventId>/<photoId><ext>` → `photoRepo.create(...)` capturing `uploaderName`, `deviceId` (body), `userAgent` (header), `ipAddress` (`req.ip`) → `emitPhotoAdded(code, photo)`. Returns `Photo[]`.

**Files:**
- `server/src/routes/publicEvents.ts` (modify — add upload handler; keep Plan 2 read routes)
- `server/tests/routes/upload.test.ts` (new)

Assumptions about Plan 2's `publicEvents.ts`: it exports a factory `createPublicEventsRouter(deps)` (or similar) wired in `app.ts`. This task assumes the router is created by a factory that already receives `{ eventRepo, photoRepo, settingsRepo, realtime, config }` from `app.ts`. If Plan 2 instead built the router from module-level singletons, adapt by importing the same singletons; the handler body below is unchanged.

Steps:

- [ ] Write failing test `server/tests/routes/upload.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, afterAll } from 'vitest';
  import request from 'supertest';
  import { promises as fs } from 'node:fs';
  import path from 'node:path';
  import { createTestApp } from '../helpers/testApp.js';
  import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

  describe('POST /api/events/by-code/:code/upload', () => {
    const dirs: string[] = [];
    afterAll(async () => { await cleanupTmp(dirs); });

    it('uploads two images, writes files, persists rows, returns Photo[]', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
      const ev = await seedActiveEvent({ code: 'party1', uploadEnabled: true });

      const jpeg = await makeJpegBuffer(800, 600);
      const res = await request(app)
        .post('/api/events/by-code/party1/upload')
        .field('uploaderName', 'Bob')
        .field('deviceId', 'dev-1')
        .attach('files', jpeg, 'one.jpg')
        .attach('files', jpeg, 'two.jpg');

      expect(res.status).toBe(201);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      const photo = res.body[0];
      expect(photo.uploaderName).toBe('Bob');
      expect(photo.mediaType).toBe('image');
      expect(photo.displayUrl).toMatch(/^\/media\/display\/.+\.jpg$/);
      expect(photo.thumbUrl).toMatch(/^\/media\/thumb\/.+\.jpg$/);
      // public Photo must NOT expose device fields
      expect(photo.deviceId).toBeUndefined();
      expect(photo.ipAddress).toBeUndefined();

      // original written under uploads/<eventId>/
      const eventDir = path.join(uploadsDir, ev.id);
      const entries = await fs.readdir(eventDir);
      expect(entries).toHaveLength(2);
      // derived files exist
      await expect(fs.stat(path.join(dataDir, 'media', 'display', `${photo.id}.jpg`))).resolves.toBeDefined();
      await expect(fs.stat(path.join(dataDir, 'media', 'thumb', `${photo.id}.jpg`))).resolves.toBeDefined();
    });

    it('returns 403 when uploads are disabled', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
      await seedActiveEvent({ code: 'closed1', uploadEnabled: false });
      const jpeg = await makeJpegBuffer(100, 100);
      const res = await request(app)
        .post('/api/events/by-code/closed1/upload')
        .field('uploaderName', 'X')
        .field('deviceId', 'd')
        .attach('files', jpeg, 'a.jpg');
      expect(res.status).toBe(403);
    });

    it('returns 404 for an unknown event code', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app } = await createTestApp({ dataDir, uploadsDir });
      const jpeg = await makeJpegBuffer(100, 100);
      const res = await request(app)
        .post('/api/events/by-code/nope/upload')
        .field('uploaderName', 'X')
        .field('deviceId', 'd')
        .attach('files', jpeg, 'a.jpg');
      expect(res.status).toBe(404);
    });

    it('rate-limits a flood of uploads from the same device (429)', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app, seedActiveEvent } = await createTestApp({
        dataDir,
        uploadsDir,
        uploadRateMax: 2, // tiny window for the test
      });
      await seedActiveEvent({ code: 'rl1', uploadEnabled: true });
      const jpeg = await makeJpegBuffer(100, 100);
      const send = () =>
        request(app)
          .post('/api/events/by-code/rl1/upload')
          .field('uploaderName', 'Flood')
          .field('deviceId', 'dev-flood')
          .attach('files', jpeg, 'a.jpg');
      const r1 = await send();
      const r2 = await send();
      const r3 = await send();
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r3.status).toBe(429);
    });
  });
  ```
- [ ] **Add a shared test-app helper** `server/tests/helpers/testApp.ts` (new) that builds the real app against a fresh in-memory/temp SQLite DB, seeds a theme + active event, and exposes config overrides. This helper is reused by Tasks 6–10. Write it COMPLETE:
  ```ts
  import path from 'node:path';
  import { promises as fs } from 'node:fs';
  import { nanoid } from 'nanoid';
  import { createApp } from '../../src/app.js';
  import { openDb } from '../../src/db/connection.js';
  import { runMigrations } from '../../src/db/migrate.js';
  import { seed } from '../../src/db/seed.js';
  import { makeRepositories } from '../../src/db/repositories/index.js';
  import { DEFAULT_MOTION_CONFIG, DEFAULT_THEME_ID } from '@rtpa/shared';
  import type { Photo } from '@rtpa/shared';

  export interface TestAppOptions {
    dataDir: string;
    uploadsDir: string;
    uploadRateMax?: number; // override rate-limit max for tests
  }

  export interface SeedEventOptions {
    code: string;
    uploadEnabled?: boolean;
    status?: 'active' | 'paused' | 'ended';
  }

  /**
   * Build the real Express app against a temp SQLite db with migrations+seed applied.
   * Realtime is a no-op spy so tests can assert emit calls without a running socket server.
   */
  export async function createTestApp(opts: TestAppOptions) {
    await fs.mkdir(opts.dataDir, { recursive: true });
    await fs.mkdir(opts.uploadsDir, { recursive: true });
    const dbPath = path.join(opts.dataDir, 'test.sqlite');
    const db = openDb(dbPath);
    runMigrations(db);
    seed(db); // seeds 9 theme presets incl. DEFAULT_THEME_ID

    const repos = makeRepositories(db);

    // No-op realtime that records emitted events for assertions.
    const emitted: Array<{ type: string; code: string; payload: unknown }> = [];
    const realtime = {
      emitPhotoAdded: (code: string, photo: Photo) =>
        emitted.push({ type: 'photo:added', code, payload: photo }),
      emitPhotoHidden: (code: string, id: string) =>
        emitted.push({ type: 'photo:hidden', code, payload: { id } }),
      emitPhotoDeleted: (code: string, id: string) =>
        emitted.push({ type: 'photo:deleted', code, payload: { id } }),
      emitSettingsUpdated: () => undefined,
      emitThemeUpdated: () => undefined,
    };

    const config = {
      port: 0,
      dataDir: opts.dataDir,
      uploadsDir: opts.uploadsDir,
      adminPassword: 'test-admin-pw',
      publicBaseUrl: 'http://localhost:8080',
      sessionSecret: 'test-secret',
      nodeEnv: 'test',
    };

    const app = createApp({
      repos,
      realtime,
      config,
      uploadRateMax: opts.uploadRateMax ?? 100,
    });

    async function seedActiveEvent(o: SeedEventOptions) {
      const ev = repos.eventRepo.create({
        name: `Event ${o.code}`,
        code: o.code,
        themeId: DEFAULT_THEME_ID,
        motionConfig: DEFAULT_MOTION_CONFIG,
      });
      repos.eventRepo.activate(ev.id);
      if (o.uploadEnabled === false) repos.eventRepo.setUploadEnabled(ev.id, false);
      if (o.status === 'ended') repos.eventRepo.end(ev.id);
      return repos.eventRepo.getByCode(o.code)!;
    }

    return { app, repos, realtime, emitted, config, db, seedActiveEvent };
  }
  ```
  > NOTE: `createApp(...)` and `makeRepositories(db)` are produced by Plans 1 & 2. If their exact factory shapes differ (e.g. `buildApp`, or repos exposed individually), adjust ONLY the import lines and the `createApp` call — the test bodies and handler logic in this plan are stable. The accepted-by-`createApp` `uploadRateMax` option is added in Task 10's `app.ts` modification.
- [ ] Run `npm test -w @rtpa/server -- tests/routes/upload.test.ts` and confirm it FAILS (route not registered / module shape).
- [ ] Add the upload handler to `server/src/routes/publicEvents.ts`. Append/extend the existing router factory so it also accepts the new deps and registers the route. Write the COMPLETE addition (showing the full factory so the handler is unambiguous):
  ```ts
  import { Router } from 'express';
  import rateLimit from 'express-rate-limit';
  import { nanoid } from 'nanoid';
  import { promises as fs } from 'node:fs';
  import path from 'node:path';
  import { DEFAULT_MEDIA_LIMITS, SETTINGS_KEYS } from '@rtpa/shared';
  import type { MediaLimits, Photo } from '@rtpa/shared';
  import { makeUploadMiddleware } from '../middleware/upload.js';
  import { validateUpload, UploadValidationError } from '../services/uploadValidation.js';
  import { processImage } from '../services/imageService.js';
  import { processVideo, probeVideo } from '../services/videoService.js';

  export interface PublicEventsDeps {
    repos: import('../db/repositories/index.js').Repositories;
    realtime: import('../realtime/realtime.js').RealtimeEmitter;
    config: { dataDir: string; uploadsDir: string };
    uploadRateMax?: number;
  }

  export function createPublicEventsRouter(deps: PublicEventsDeps): Router {
    const { repos, realtime, config } = deps;
    const router = Router();

    // ---- Plan 2 read routes (GET by-code, GET by-code/photos) remain here unchanged ----
    // (do not delete the existing handlers; the upload handler below is additive)

    function getMediaLimits(): MediaLimits {
      return repos.settingsRepo.getJson<MediaLimits>(SETTINGS_KEYS.mediaLimits) ?? DEFAULT_MEDIA_LIMITS;
    }

    const uploadLimiter = rateLimit({
      windowMs: 60_000,
      max: deps.uploadRateMax ?? 60,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : 'nodevice';
        return `${deviceId}:${req.ip}`;
      },
    });

    // Build per-file cap once at registration from current limits (max of photo/video).
    const perFileMax = Math.max(getMediaLimits().photoMaxBytes, getMediaLimits().videoMaxBytes);
    const uploadMiddleware = makeUploadMiddleware(perFileMax);

    router.post(
      '/by-code/:code/upload',
      uploadMiddleware, // parses multipart so req.body.deviceId exists for the limiter
      uploadLimiter,
      async (req, res, next) => {
        try {
          const { code } = req.params;
          const event = repos.eventRepo.getByCode(code);
          if (!event) return res.status(404).json({ error: 'event not found' });
          if (event.status === 'ended' || !event.uploadEnabled) {
            return res.status(403).json({ error: 'uploads are closed' });
          }

          const files = (req.files as Express.Multer.File[]) ?? [];
          if (files.length === 0) return res.status(400).json({ error: 'no files' });

          const uploaderName =
            typeof req.body.uploaderName === 'string' && req.body.uploaderName.trim()
              ? req.body.uploaderName.trim().slice(0, 80)
              : 'Guest';
          const deviceId = typeof req.body.deviceId === 'string' ? req.body.deviceId : '';
          const userAgent = req.get('user-agent') ?? '';
          const ipAddress = req.ip ?? '';
          const limits = getMediaLimits();

          const eventDir = path.join(config.uploadsDir, event.id);
          await fs.mkdir(eventDir, { recursive: true });

          const created: Photo[] = [];

          for (const file of files) {
            const v = validateUpload({
              buffer: file.buffer,
              mimetype: file.mimetype,
              sizeBytes: file.size,
              limits,
            });
            const photoId = nanoid();
            const originalPath = path.join(eventDir, `${photoId}${v.ext}`);
            await fs.writeFile(originalPath, file.buffer);

            if (v.mediaType === 'image') {
              const out = await processImage(file.buffer, photoId, config.dataDir);
              const row = repos.photoRepo.create({
                eventId: event.id,
                uploaderName,
                filePath: originalPath,
                displayPath: out.displayPath,
                thumbPath: out.thumbPath,
                mediaType: 'image',
                width: out.width,
                height: out.height,
                durationMs: null,
                deviceId,
                userAgent,
                ipAddress,
              });
              created.push(toPublicPhoto(row));
            } else {
              // video: enforce duration cap too (defense in depth beyond byte cap)
              const probe = await probeVideo(originalPath);
              if (probe.durationMs > limits.videoMaxDurationSec * 1000 + 1500) {
                // still process but trimmed; we simply cap, not reject, per pipeline rules
              }
              const out = await processVideo(
                originalPath,
                photoId,
                config.dataDir,
                limits.videoMaxDurationSec,
              );
              const row = repos.photoRepo.create({
                eventId: event.id,
                uploaderName,
                filePath: originalPath,
                displayPath: out.displayPath,
                thumbPath: out.thumbPath,
                mediaType: 'video',
                width: out.width,
                height: out.height,
                durationMs: out.durationMs,
                deviceId,
                userAgent,
                ipAddress,
              });
              created.push(toPublicPhoto(row));
            }
          }

          for (const p of created) realtime.emitPhotoAdded(code, p);
          return res.status(201).json(created);
        } catch (err) {
          if (err instanceof UploadValidationError) {
            return res.status(400).json({ error: err.message, code: err.code });
          }
          return next(err);
        }
      },
    );

    return router;
  }

  /** Strip admin-only device fields from a PhotoAdmin row to produce a public Photo. */
  function toPublicPhoto(row: import('@rtpa/shared').PhotoAdmin): Photo {
    const { deviceId, userAgent, ipAddress, ...pub } = row;
    return pub;
  }
  ```
  > NOTE: If Plan 2's `publicEvents.ts` already defines `createPublicEventsRouter` with a different deps shape, MERGE this `router.post('/by-code/:code/upload', ...)` block and the helpers into the existing factory rather than redefining it. Keep the existing GET handlers.
- [ ] Run `npm test -w @rtpa/server -- tests/routes/upload.test.ts` and confirm it PASSES. (The image-only path is fast; a video upload variant is exercised in the Task 10 integration test if desired — keep this task image-focused to stay fast.)
- [ ] Commit: `feat(server): add public upload route (validate, process, persist, broadcast)`

---

## Task 7: Admin photos list — `src/routes/adminPhotos.ts` (GET list)

`GET /api/admin/events/:id/photos` → `PhotoAdmin[]` newest-first, including private device fields. Requires admin auth.

**Files:**
- `server/src/routes/adminPhotos.ts` (new)
- `server/tests/routes/adminPhotos.list.test.ts` (new)

Steps:

- [ ] Write failing test `server/tests/routes/adminPhotos.list.test.ts`:
  ```ts
  import { describe, it, expect, afterAll } from 'vitest';
  import request from 'supertest';
  import { createTestApp } from '../helpers/testApp.js';
  import { loginAdmin } from '../helpers/auth.js';
  import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

  describe('GET /api/admin/events/:id/photos', () => {
    const dirs: string[] = [];
    afterAll(async () => { await cleanupTmp(dirs); });

    it('returns PhotoAdmin[] newest-first with device fields', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
      const ev = await seedActiveEvent({ code: 'adm1', uploadEnabled: true });

      const jpeg = await makeJpegBuffer(200, 200);
      await request(app)
        .post('/api/events/by-code/adm1/upload')
        .field('uploaderName', 'First').field('deviceId', 'd-first')
        .attach('files', jpeg, '1.jpg');
      await request(app)
        .post('/api/events/by-code/adm1/upload')
        .field('uploaderName', 'Second').field('deviceId', 'd-second')
        .attach('files', jpeg, '2.jpg');

      const agent = await loginAdmin(app);
      const res = await agent.get(`/api/admin/events/${ev.id}/photos`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      // newest-first: 'Second' uploaded last
      expect(res.body[0].uploaderName).toBe('Second');
      // admin view DOES include device fields
      expect(res.body[0].deviceId).toBe('d-second');
      expect(res.body[0]).toHaveProperty('userAgent');
      expect(res.body[0]).toHaveProperty('ipAddress');
    });

    it('requires admin auth (401 without cookie)', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
      const ev = await seedActiveEvent({ code: 'adm2', uploadEnabled: true });
      const res = await request(app).get(`/api/admin/events/${ev.id}/photos`);
      expect(res.status).toBe(401);
    });
  });
  ```
- [ ] **Add admin-login test helper** `server/tests/helpers/auth.ts` (new), reused by Tasks 7–10:
  ```ts
  import request from 'supertest';
  import type { Express } from 'express';

  /** Log in as admin (password from createTestApp config) and return an agent with the cookie. */
  export async function loginAdmin(app: Express, password = 'test-admin-pw') {
    const agent = request.agent(app);
    const res = await agent.post('/api/admin/login').send({ password });
    if (res.status !== 200) {
      throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return agent;
  }
  ```
  > NOTE: This assumes Plan 2 seeds the admin password hash from `config.adminPassword` on first run. If `createTestApp` must explicitly set it, add a `repos.settingsRepo.set(SETTINGS_KEYS.adminPasswordHash, bcrypt.hashSync('test-admin-pw', 10))` call in `testApp.ts` after `seed(db)`.
- [ ] Run `npm test -w @rtpa/server -- tests/routes/adminPhotos.list.test.ts` and confirm it FAILS (route not registered).
- [ ] Write COMPLETE `server/src/routes/adminPhotos.ts` (this file also hosts hide/delete added in Tasks 8–9; start with the factory + list route):
  ```ts
  import { Router } from 'express';
  import type { Repositories } from '../db/repositories/index.js';
  import type { RealtimeEmitter } from '../realtime/realtime.js';

  export interface AdminPhotosDeps {
    repos: Repositories;
    realtime: RealtimeEmitter;
    requireAuth: import('express').RequestHandler;
    config: { uploadsDir: string; dataDir: string };
  }

  /**
   * Admin photo routes. Mounted under /api/admin. Provides:
   *   GET    /events/:id/photos    -> PhotoAdmin[] (newest-first, incl. device fields)
   *   POST   /photos/:id/hide      -> 204 (Task 8)
   *   DELETE /photos/:id           -> 204 (Task 8)
   */
  export function createAdminPhotosRouter(deps: AdminPhotosDeps): Router {
    const { repos, requireAuth } = deps;
    const router = Router();

    router.get('/events/:id/photos', requireAuth, (req, res) => {
      const event = repos.eventRepo.getById(req.params.id);
      if (!event) return res.status(404).json({ error: 'event not found' });
      const photos = repos.photoRepo.listForEventAdmin(event.id);
      return res.json(photos);
    });

    return router;
  }
  ```
  > NOTE: `requireAuth` is Plan 2's middleware. `app.ts` (Task 10) passes it in. If Plan 2 exports `requireAuth` as an importable singleton instead, import it directly and drop it from deps.
- [ ] Wire this router in `app.ts` is done in Task 10, but to make THIS test pass now, add the mount line in `app.ts` as part of this task too (see Task 10 for the full `app.ts`); minimally add:
  ```ts
  app.use('/api/admin', createAdminPhotosRouter({ repos, realtime, requireAuth, config }));
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/routes/adminPhotos.list.test.ts` and confirm it PASSES.
- [ ] Commit: `feat(server): add admin photos list route`

---

## Task 8: Admin hide + delete — extend `src/routes/adminPhotos.ts`

`POST /api/admin/photos/:id/hide {hidden}`: `setHidden(id, hidden)`; if `hidden===true` → `emitPhotoHidden(code, id)`; if `false` → `emitPhotoAdded(code, visiblePhoto)`. `DELETE /api/admin/photos/:id`: delete original + display + thumb files (ignore missing), `photoRepo.remove(id)`, `emitPhotoDeleted(code, id)`. Both 204.

**Files:**
- `server/src/routes/adminPhotos.ts` (modify — add hide + delete handlers)
- `server/tests/routes/adminPhotos.mutate.test.ts` (new)

Steps:

- [ ] Write failing test `server/tests/routes/adminPhotos.mutate.test.ts`:
  ```ts
  import { describe, it, expect, afterAll } from 'vitest';
  import request from 'supertest';
  import { promises as fs } from 'node:fs';
  import { createTestApp } from '../helpers/testApp.js';
  import { loginAdmin } from '../helpers/auth.js';
  import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

  async function uploadOne(app: any, code: string) {
    const jpeg = await makeJpegBuffer(200, 200);
    const res = await request(app)
      .post(`/api/events/by-code/${code}/upload`)
      .field('uploaderName', 'U').field('deviceId', 'd')
      .attach('files', jpeg, 'x.jpg');
    return res.body[0];
  }

  describe('admin hide/delete', () => {
    const dirs: string[] = [];
    afterAll(async () => { await cleanupTmp(dirs); });

    it('hide then unhide emits the right events and toggles visibility', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app, emitted, repos, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
      await seedActiveEvent({ code: 'hd1', uploadEnabled: true });
      const photo = await uploadOne(app, 'hd1');
      const agent = await loginAdmin(app);

      const hideRes = await agent.post(`/api/admin/photos/${photo.id}/hide`).send({ hidden: true });
      expect(hideRes.status).toBe(204);
      expect(repos.photoRepo.getById(photo.id)!.isHidden).toBe(true);
      expect(emitted.some((e) => e.type === 'photo:hidden' && (e.payload as any).id === photo.id)).toBe(true);

      const unhideRes = await agent.post(`/api/admin/photos/${photo.id}/hide`).send({ hidden: false });
      expect(unhideRes.status).toBe(204);
      expect(repos.photoRepo.getById(photo.id)!.isHidden).toBe(false);
      // unhide re-broadcasts photo:added with a visible Photo
      const added = emitted.filter((e) => e.type === 'photo:added');
      expect((added[added.length - 1].payload as any).id).toBe(photo.id);
    });

    it('delete removes files and row and emits photo:deleted', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app, emitted, repos, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
      await seedActiveEvent({ code: 'dl1', uploadEnabled: true });
      const photo = await uploadOne(app, 'dl1');
      const row = repos.photoRepo.getById(photo.id)!;
      // files exist before delete
      await expect(fs.stat(row.filePath)).resolves.toBeDefined();
      await expect(fs.stat(row.displayPath)).resolves.toBeDefined();
      await expect(fs.stat(row.thumbPath)).resolves.toBeDefined();

      const agent = await loginAdmin(app);
      const delRes = await agent.delete(`/api/admin/photos/${photo.id}`);
      expect(delRes.status).toBe(204);

      // files removed
      await expect(fs.stat(row.filePath)).rejects.toBeDefined();
      await expect(fs.stat(row.displayPath)).rejects.toBeDefined();
      await expect(fs.stat(row.thumbPath)).rejects.toBeDefined();
      // row gone
      expect(repos.photoRepo.getById(photo.id)).toBeUndefined();
      // broadcast
      expect(emitted.some((e) => e.type === 'photo:deleted' && (e.payload as any).id === photo.id)).toBe(true);
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/routes/adminPhotos.mutate.test.ts` and confirm it FAILS (routes not registered).
- [ ] Extend `server/src/routes/adminPhotos.ts` — add inside `createAdminPhotosRouter`, before `return router;`. Write the COMPLETE additions:
  ```ts
    // helper: resolve the event code for a photo (needed for room-scoped broadcasts)
    function eventCodeForPhoto(eventId: string): string | undefined {
      return repos.eventRepo.getById(eventId)?.code;
    }

    // helper: strip admin-only device fields to a public Photo
    function toPublicPhoto(row: import('@rtpa/shared').PhotoAdmin): import('@rtpa/shared').Photo {
      const { deviceId, userAgent, ipAddress, ...pub } = row;
      return pub;
    }

    router.post('/photos/:id/hide', requireAuth, (req, res) => {
      const photo = repos.photoRepo.getById(req.params.id);
      if (!photo) return res.status(404).json({ error: 'photo not found' });
      const hidden = req.body?.hidden === true;
      repos.photoRepo.setHidden(photo.id, hidden);
      const code = eventCodeForPhoto(photo.eventId);
      if (code) {
        if (hidden) {
          deps.realtime.emitPhotoHidden(code, photo.id);
        } else {
          const fresh = repos.photoRepo.getById(photo.id);
          if (fresh) deps.realtime.emitPhotoAdded(code, toPublicPhoto(fresh));
        }
      }
      return res.status(204).end();
    });

    router.delete('/photos/:id', requireAuth, async (req, res) => {
      const photo = repos.photoRepo.getById(req.params.id);
      if (!photo) return res.status(404).json({ error: 'photo not found' });
      const code = eventCodeForPhoto(photo.eventId);
      // delete files, ignoring missing
      const { promises: fsp } = await import('node:fs');
      await Promise.all(
        [photo.filePath, photo.displayPath, photo.thumbPath].map((p) =>
          fsp.rm(p, { force: true }).catch(() => undefined),
        ),
      );
      repos.photoRepo.remove(photo.id);
      if (code) deps.realtime.emitPhotoDeleted(code, photo.id);
      return res.status(204).end();
    });
  ```
  > NOTE: `PhotoAdmin` from `photoRepo.getById` includes `filePath`/`displayPath`/`thumbPath`? The contract's `PhotoCreateInput` stores these paths, and `getById` returns `PhotoAdmin`. If `PhotoAdmin` does not surface the raw file paths, add a `photoRepo.getPaths(id): { filePath; displayPath; thumbPath } | undefined` to Plan 1's repo (the schema stores them) and use it here. Per the schema (`file_path`, `display_path`, `thumb_path` columns exist), the simplest contract-compatible approach is for `getById` to include them; this plan assumes they are accessible on the admin row. If not, use the `getPaths` accessor.
- [ ] Run `npm test -w @rtpa/server -- tests/routes/adminPhotos.mutate.test.ts` and confirm it PASSES.
- [ ] Commit: `feat(server): add admin hide/unhide and delete photo routes`

---

## Task 9: exportService + export route

`src/services/exportService.ts` streams an `archiver` zip of all originals named `<index>-<uploaderName>-<photoId><ext>` plus `manifest.json` (array of `{ photoId, uploaderName, createdAt, mediaType, filename }`). Route `GET /api/admin/events/:id/export` (`src/routes/adminExport.ts`) streams it to `res` with a `Content-Disposition` attachment.

**Files:**
- `server/src/services/exportService.ts` (new)
- `server/src/routes/adminExport.ts` (new)
- `server/tests/routes/adminExport.test.ts` (new)

Steps:

- [ ] Write failing test `server/tests/routes/adminExport.test.ts`:
  ```ts
  import { describe, it, expect, afterAll } from 'vitest';
  import request from 'supertest';
  import AdmZip from 'adm-zip';
  import { createTestApp } from '../helpers/testApp.js';
  import { loginAdmin } from '../helpers/auth.js';
  import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

  describe('GET /api/admin/events/:id/export', () => {
    const dirs: string[] = [];
    afterAll(async () => { await cleanupTmp(dirs); });

    it('streams a zip containing manifest.json + N originals', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
      const ev = await seedActiveEvent({ code: 'exp1', uploadEnabled: true });

      const jpeg = await makeJpegBuffer(200, 200);
      await request(app).post('/api/events/by-code/exp1/upload')
        .field('uploaderName', 'Amy').field('deviceId', 'd1').attach('files', jpeg, 'a.jpg');
      await request(app).post('/api/events/by-code/exp1/upload')
        .field('uploaderName', 'Ben').field('deviceId', 'd2').attach('files', jpeg, 'b.jpg');

      const agent = await loginAdmin(app);
      const res = await agent
        .get(`/api/admin/events/${ev.id}/export`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/zip/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);

      const zip = new AdmZip(res.body as Buffer);
      const names = zip.getEntries().map((e) => e.entryName);
      expect(names).toContain('manifest.json');
      // 2 originals + manifest
      const originals = names.filter((n) => n !== 'manifest.json');
      expect(originals).toHaveLength(2);
      expect(originals.some((n) => n.includes('Amy'))).toBe(true);
      expect(originals.some((n) => n.includes('Ben'))).toBe(true);

      const manifest = JSON.parse(zip.readAsText('manifest.json'));
      expect(Array.isArray(manifest)).toBe(true);
      expect(manifest).toHaveLength(2);
      expect(manifest[0]).toHaveProperty('photoId');
      expect(manifest[0]).toHaveProperty('uploaderName');
      expect(manifest[0]).toHaveProperty('createdAt');
      expect(manifest[0]).toHaveProperty('mediaType');
      expect(manifest[0]).toHaveProperty('filename');
    });

    it('requires admin auth', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
      const ev = await seedActiveEvent({ code: 'exp2', uploadEnabled: true });
      const res = await request(app).get(`/api/admin/events/${ev.id}/export`);
      expect(res.status).toBe(401);
    });
  });
  ```
- [ ] Ensure `adm-zip` is available as a devDependency for the test (zip reader). If not present:
  ```bash
  npm install -D -w @rtpa/server adm-zip @types/adm-zip
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/routes/adminExport.test.ts` and confirm it FAILS (module not found / route not registered).
- [ ] Write COMPLETE `server/src/services/exportService.ts`:
  ```ts
  import path from 'node:path';
  import { createReadStream, existsSync } from 'node:fs';
  import type { Writable } from 'node:stream';
  import archiver from 'archiver';
  import type { PhotoAdmin } from '@rtpa/shared';

  export interface ExportManifestEntry {
    photoId: string;
    uploaderName: string;
    createdAt: string;
    mediaType: string;
    filename: string;
  }

  /** Sanitize uploader name for use inside an archive filename. */
  function safeName(name: string): string {
    return (name || 'guest').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_') || 'guest';
  }

  /**
   * Stream a zip of all originals for the given photos into `out`. Each entry is named
   * `<index>-<uploaderName>-<photoId><ext>`; a manifest.json describing every entry is
   * appended. Returns a promise that resolves when the archive has fully finalized.
   */
  export function streamAlbumZip(photos: PhotoAdmin[], out: Writable): Promise<void> {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', reject);
      archive.on('end', () => resolve());
      out.on('error', reject);
      archive.pipe(out);

      const manifest: ExportManifestEntry[] = [];
      photos.forEach((photo, idx) => {
        const ext = path.extname(photo.filePath) || '';
        const filename = `${idx + 1}-${safeName(photo.uploaderName)}-${photo.id}${ext}`;
        if (existsSync(photo.filePath)) {
          archive.append(createReadStream(photo.filePath), { name: filename });
        }
        manifest.push({
          photoId: photo.id,
          uploaderName: photo.uploaderName,
          createdAt: photo.createdAt,
          mediaType: photo.mediaType,
          filename,
        });
      });

      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      archive.finalize().catch(reject);
    });
  }
  ```
  > NOTE: `streamAlbumZip` needs `filePath` from `PhotoAdmin`. Same assumption as Task 8: the admin row exposes the original `filePath` (schema column `file_path`). If `PhotoAdmin` omits it, fetch paths via the `photoRepo.getPaths(id)` accessor inside the route and pass an augmented list.
- [ ] Write COMPLETE `server/src/routes/adminExport.ts`:
  ```ts
  import { Router } from 'express';
  import type { Repositories } from '../db/repositories/index.js';
  import { streamAlbumZip } from '../services/exportService.js';

  export interface AdminExportDeps {
    repos: Repositories;
    requireAuth: import('express').RequestHandler;
  }

  /** GET /api/admin/events/:id/export -> application/zip stream of all originals + manifest. */
  export function createAdminExportRouter(deps: AdminExportDeps): Router {
    const { repos, requireAuth } = deps;
    const router = Router();

    router.get('/events/:id/export', requireAuth, async (req, res, next) => {
      try {
        const event = repos.eventRepo.getById(req.params.id);
        if (!event) return res.status(404).json({ error: 'event not found' });
        const photos = repos.photoRepo.listForEventAdmin(event.id);

        const filenameSafe = event.code.replace(/[^a-zA-Z0-9_-]/g, '') || 'album';
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="album-${filenameSafe}.zip"`,
        );
        await streamAlbumZip(photos, res);
        // streamAlbumZip pipes to res and resolves on archive end; res ends with the stream.
      } catch (err) {
        if (!res.headersSent) return next(err);
        res.destroy(err as Error);
      }
    });

    return router;
  }
  ```
- [ ] Mount in `app.ts` (full file in Task 10); minimally for this test add:
  ```ts
  app.use('/api/admin', createAdminExportRouter({ repos, requireAuth }));
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/routes/adminExport.test.ts` and confirm it PASSES.
- [ ] Commit: `feat(server): add album export service + streamed zip route`

---

## Task 10: Wire routers in `app.ts` + end-to-end integration test

Modify `app.ts` to construct and mount the public upload, admin photos, and admin export routers with shared deps and accept a `uploadRateMax` option. Then an integration test: upload 2 images via the public route → admin list shows 2 newest-first → hide one → public photos shows 1 → export zip has 2 originals.

**Files:**
- `server/src/app.ts` (modify)
- `server/tests/integration/pipeline.test.ts` (new)

Steps:

- [ ] Write failing test `server/tests/integration/pipeline.test.ts`:
  ```ts
  import { describe, it, expect, afterAll } from 'vitest';
  import request from 'supertest';
  import AdmZip from 'adm-zip';
  import { createTestApp } from '../helpers/testApp.js';
  import { loginAdmin } from '../helpers/auth.js';
  import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

  describe('media pipeline end-to-end', () => {
    const dirs: string[] = [];
    afterAll(async () => { await cleanupTmp(dirs); });

    it('upload 2 -> admin list 2 -> hide 1 -> public 1 -> export 2', async () => {
      const dataDir = await makeTmpDir();
      const uploadsDir = await makeTmpDir();
      dirs.push(dataDir, uploadsDir);
      const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
      const ev = await seedActiveEvent({ code: 'e2e1', uploadEnabled: true });
      const jpeg = await makeJpegBuffer(300, 200);

      const up1 = await request(app).post('/api/events/by-code/e2e1/upload')
        .field('uploaderName', 'One').field('deviceId', 'd1').attach('files', jpeg, '1.jpg');
      const up2 = await request(app).post('/api/events/by-code/e2e1/upload')
        .field('uploaderName', 'Two').field('deviceId', 'd2').attach('files', jpeg, '2.jpg');
      expect(up1.status).toBe(201);
      expect(up2.status).toBe(201);
      const photo1 = up1.body[0];

      const agent = await loginAdmin(app);

      // admin list shows 2, newest-first
      const list = await agent.get(`/api/admin/events/${ev.id}/photos`);
      expect(list.body).toHaveLength(2);
      expect(list.body[0].uploaderName).toBe('Two');

      // hide photo1
      const hide = await agent.post(`/api/admin/photos/${photo1.id}/hide`).send({ hidden: true });
      expect(hide.status).toBe(204);

      // public photos now shows 1 (visible only)
      const pub = await request(app).get('/api/events/by-code/e2e1/photos');
      expect(pub.status).toBe(200);
      expect(pub.body).toHaveLength(1);
      expect(pub.body[0].uploaderName).toBe('Two');

      // export still includes BOTH originals (hidden files are kept)
      const exp = await agent
        .get(`/api/admin/events/${ev.id}/export`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      const zip = new AdmZip(exp.body as Buffer);
      const originals = zip.getEntries().map((e) => e.entryName).filter((n) => n !== 'manifest.json');
      expect(originals).toHaveLength(2);
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/server -- tests/integration/pipeline.test.ts` and confirm it FAILS (routers not wired / `uploadRateMax` not accepted).
- [ ] Modify `server/src/app.ts` to mount all Plan 3 routers and accept `uploadRateMax`. Show the COMPLETE relevant section of `createApp` (merge into the existing Plan 1/2 `app.ts`, keeping all prior middleware, health route, admin auth/events/themes/settings routers, public read router, media static route, and the error handler LAST):
  ```ts
  import express from 'express';
  import cookieParser from 'cookie-parser';
  import type { Repositories } from './db/repositories/index.js';
  import type { RealtimeEmitter } from './realtime/realtime.js';
  import type { Config } from './config.js';
  import { errorHandler } from './middleware/errorHandler.js';
  // Plan 2 imports (auth + routers) assumed present:
  import { makeRequireAuth } from './auth/auth.js';
  // Plan 3 routers:
  import { createPublicEventsRouter } from './routes/publicEvents.js';
  import { createAdminPhotosRouter } from './routes/adminPhotos.js';
  import { createAdminExportRouter } from './routes/adminExport.js';

  export interface CreateAppDeps {
    repos: Repositories;
    realtime: RealtimeEmitter;
    config: Config;
    uploadRateMax?: number;
  }

  export function createApp(deps: CreateAppDeps): express.Express {
    const { repos, realtime, config } = deps;
    const app = express();
    app.set('trust proxy', true); // so req.ip respects X-Forwarded-For behind reverse proxy
    app.use(cookieParser());
    // NOTE: do NOT app.use(express.json()) globally before the multipart upload route in a
    // way that consumes its body; json parsing is fine because multipart isn't JSON. Keep
    // express.json() mounted for /api routes that need it (admin JSON bodies).
    app.use(express.json());

    const requireAuth = makeRequireAuth({ repos, config });

    // ---- Plan 1/2 routes remain mounted here (health, adminAuth, adminEvents,
    //      adminThemes, adminSettings, public read router, media static) ----

    // Public events router (Plan 2 read routes + Plan 3 upload) — single mount.
    app.use(
      '/api/events',
      createPublicEventsRouter({
        repos,
        realtime,
        config: { dataDir: config.dataDir, uploadsDir: config.uploadsDir },
        uploadRateMax: deps.uploadRateMax,
      }),
    );

    // Plan 3 admin routers.
    app.use('/api/admin', createAdminPhotosRouter({ repos, realtime, requireAuth, config }));
    app.use('/api/admin', createAdminExportRouter({ repos, requireAuth }));

    // Error handler LAST.
    app.use(errorHandler);
    return app;
  }
  ```
  > NOTE: If Plan 2 already mounts `createPublicEventsRouter` (for its read routes), do NOT mount it twice — instead ensure the single mount passes the Plan 3 deps (`realtime`, `config`, `uploadRateMax`) so the upload handler works. The `trust proxy` setting and the admin/export mounts are the net-new lines for Plan 3.
- [ ] Run `npm test -w @rtpa/server -- tests/integration/pipeline.test.ts` and confirm it PASSES.
- [ ] Run the FULL server suite to confirm no regressions: `npm test -w @rtpa/server`. Confirm all Plan 3 tests (fixtures, imageService, videoService, uploadValidation, upload middleware, upload route, admin list, admin mutate, export, integration) PASS.
- [ ] Commit: `feat(server): wire media pipeline routers in app and add e2e integration test`

---

## Plan 3 self-check (spec coverage map)

| Spec item | Where covered in this plan |
|-----------|----------------------------|
| §7 client/server caps (photo ≤ photoMaxBytes; video ≤ videoMaxBytes & ≤ videoMaxDurationSec) | Task 3 (duration cap in `processVideo`), Task 4 (`uploadValidation` size caps + boundaries), Task 5 (per-file Multer cap) |
| §7 type must be image/* or video/* | Task 4 (magic-byte detect + mime-family agreement), Task 5 (Multer `fileFilter`) |
| §7 captures device_id (body), user_agent (header), IP (server) privately | Task 6 (handler passes `deviceId`/`userAgent`/`ipAddress` to `photoRepo.create`); public `Photo` strips them (Task 6 `toPublicPhoto`, asserted in upload test) |
| §7 `upload_enabled` off → uploads closed (403) | Task 6 (403 on `!uploadEnabled` / `status==='ended'`; tested) |
| §11 Album manager: grid newest-first, private device info | Task 7 (`GET /events/:id/photos` → `PhotoAdmin[]` newest-first incl. device fields; auth-gated) |
| §11 Hide (keep file) / Delete (remove file), reflected on live display | Task 8 (`hide` keeps files + emits; `delete` removes original+display+thumb, removes row, emits) |
| §11/§13 Hidden excluded from public/display | Task 8 + Task 10 (public photos shows 1 after hide via `listForEventPublic`) |
| §11 Album export: streamed zip of originals + manifest (name + timestamp) | Task 9 (`exportService` archiver stream + `manifest.json` with uploaderName/createdAt; streamed route with Content-Disposition) |
| §12 Images: sharp display+thumb, HEIC→JPEG, strip metadata except orientation | Task 2 (`imageService`: auto-orient via `rotate()`, strip, 1600/480 fits, q82/q75, HEIC handled by sharp/validation) |
| §12 Videos: ffmpeg poster + normalized/length-capped MP4, validated server-side | Task 3 (`videoService`: H.264 yuv420p faststart, trim, ≤1280 display, ≤480 poster) + Task 4 server-side size validation |
| §12 Metadata row written to SQLite | Task 6 (`photoRepo.create` per file) |
| §12 Socket.IO broadcasts photo:added / photo:hidden / photo:deleted | Task 6 (`emitPhotoAdded`), Task 8 (`emitPhotoHidden`/`emitPhotoAdded` on unhide / `emitPhotoDeleted`) |
| §13 Upload endpoint rate-limited per device_id/IP | Task 6 (`express-rate-limit` `keyGenerator` = `deviceId:ip`; 429 tested) |
| §13 Strict MIME/type validation; randomized stored filenames | Task 4 (validation), Task 6 (`nanoid()` photoId → stored filename); served images metadata-stripped (Task 2) |
| §13 Device info admin-only, name is only public attribution | Task 6/7 (public `Photo` excludes device fields; admin `PhotoAdmin` includes them — both asserted) |
