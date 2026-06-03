import { promises as fs } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

// ffmpeg-static / ffprobe-static are CJS packages whose default export is the
// binary path string; under NodeNext the default import is typed as the module
// namespace, so coerce to the actual runtime value.
const ffmpegPath = ffmpegStatic as unknown as string | null;
const ffprobePath = (ffprobeStatic as { path?: string } | undefined)?.path;

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

export interface VideoProbe {
  durationMs: number;
  width: number;
  height: number;
  /** Video stream codec name (e.g. `h264`), or `''` if unknown. */
  codec: string;
  /** Pixel format of the video stream (e.g. `yuv420p`), or `''` if unknown. */
  pixelFormat: string;
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
        codec: stream.codec_name ?? '',
        pixelFormat: stream.pix_fmt ?? '',
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

  // Poster frame at ~0.5s (or near 0 if shorter), scaled to fit <= 480 longest edge
  // (preserve aspect; do not upscale; keep even dims for clean jpeg downscale).
  const posterSec = Math.min(0.5, Math.max(0, source.durationMs / 1000 - 0.05));
  const posterScale =
    longest > THUMB_MAX
      ? source.width >= source.height
        ? `scale=${THUMB_MAX}:-2`
        : `scale=-2:${THUMB_MAX}`
      : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
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
