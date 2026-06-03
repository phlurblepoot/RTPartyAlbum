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
