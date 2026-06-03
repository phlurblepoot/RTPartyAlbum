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

export function validateFiles(files: File[], limits: MediaLimits): ValidationResult {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      rejected.push({ file, reason: 'bad-type' });
      continue;
    }

    const cap = isImage ? limits.photoMaxBytes : limits.videoMaxBytes;
    if (file.size > cap) {
      rejected.push({ file, reason: 'too-large' });
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejected };
}
