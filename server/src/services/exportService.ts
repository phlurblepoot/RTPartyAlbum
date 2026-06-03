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

export interface PhotoWithPath extends PhotoAdmin {
  filePath: string;
}

/**
 * Stream a zip of all originals for the given photos into `out`. Each entry is named
 * `<index>-<uploaderName>-<photoId><ext>`; a manifest.json describing every entry is
 * appended. Photos whose original file is missing on disk are skipped (not failed).
 * Returns a promise that resolves when the archive has fully finalized.
 */
export function streamAlbumZip(photos: PhotoWithPath[], out: Writable): Promise<void> {
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
