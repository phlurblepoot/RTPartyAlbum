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
  // resolveWithObject gives guaranteed numeric output dims (info.width/height) so we never
  // have to fall back to 0 (which would silently corrupt the photos table's NOT NULL dims).
  const { data: displayBuffer, info } = await sharp(inputBuffer)
    .rotate() // auto-orient from EXIF, then orientation is baked in
    .resize({
      width: DISPLAY_MAX,
      height: DISPLAY_MAX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  // Belt-and-suspenders: surface a failure to the route (→ 400/skip) instead of
  // writing zero dimensions if sharp ever reports missing output dims.
  if (!info.width || !info.height) {
    throw new Error('imageService: failed to determine processed image dimensions');
  }

  await fs.writeFile(displayPath, displayBuffer);

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
    width: info.width,
    height: info.height,
  };
}
