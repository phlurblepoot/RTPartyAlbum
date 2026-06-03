import type { MediaLimits } from '../api/types';

export type RejectReason = 'bad-type' | 'too-large';

export interface RejectedFile {
  file: File;
  reason: RejectReason;
}

export interface ValidationResult {
  accepted: File[];
  rejected: RejectedFile[];
}

// Extension fallbacks for when the browser reports no/garbled MIME type. iPhones
// upload HEIC/HEIF, which desktop browsers often report with an empty `file.type`,
// so we accept by extension too (the server re-verifies via magic bytes).
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i;

function classify(file: File): 'image' | 'video' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  // Unknown/empty MIME (common for HEIC): fall back to the file extension.
  if (IMAGE_EXT.test(file.name)) return 'image';
  if (VIDEO_EXT.test(file.name)) return 'video';
  return null;
}

export function validateFiles(files: File[], limits: MediaLimits): ValidationResult {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    const kind = classify(file);

    if (!kind) {
      rejected.push({ file, reason: 'bad-type' });
      continue;
    }

    const cap = kind === 'image' ? limits.photoMaxBytes : limits.videoMaxBytes;
    if (file.size > cap) {
      rejected.push({ file, reason: 'too-large' });
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejected };
}
