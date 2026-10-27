import type { RequestHandler } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { HttpError } from './errorHandler.js';

export const UPLOAD_FIELD = 'files';
export const UPLOAD_MAX_COUNT = 20;

/** Name of the scratch directory (inside UPLOADS_DIR) that incoming files stream into. */
export const INCOMING_DIRNAME = '.incoming';

/**
 * Build the Multer middleware for the public upload route.
 * - Disk storage: each file streams straight to `incomingDir` instead of being held
 *   in RAM (a 20 × 60 MB batch used to mean ~1.2 GB of buffers per request). Put
 *   `incomingDir` on the same volume as the originals so the route can `rename`
 *   files into place. Multer deletes partially written files itself when a limit
 *   trips; the route removes anything left after it finishes.
 * - Per-file byte cap = max(photoMaxBytes, videoMaxBytes); finer per-type caps are
 *   enforced afterward by uploadValidation.
 * - Accepts image/* and video/* mimetypes, plus "unspecified" types (empty or
 *   application/octet-stream) which browsers send for HEIC/HEIF — the real check
 *   is the magic-byte uploadValidation that runs afterward, so this filter only
 *   blocks obviously-wrong declared types (e.g. text/plain, application/pdf).
 * - Field name `files` (array). Text fields uploaderName/deviceId arrive on req.body.
 */
export function makeUploadMiddleware(
  perFileMaxBytes: number,
  incomingDir: string = path.join(tmpdir(), 'rtpa-incoming'),
): RequestHandler {
  mkdirSync(incomingDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: incomingDir,
      // Random name; never trust the client-supplied filename on disk.
      filename: (_req, _file, cb) => cb(null, `${nanoid()}.part`),
    }),
    limits: { fileSize: perFileMaxBytes, files: UPLOAD_MAX_COUNT },
    fileFilter: (_req, file, cb) => {
      const family = file.mimetype.split('/')[0];
      const unspecified = file.mimetype === '' || file.mimetype === 'application/octet-stream';
      if (family === 'image' || family === 'video' || unspecified) {
        cb(null, true);
      } else {
        // Throw a typed HttpError so the terminal error handler maps it to 400
        // (rather than treating an unrecognized fileFilter Error as a 500).
        cb(new HttpError(400, `unsupported mimetype: ${file.mimetype}`));
      }
    },
  });
  return upload.array(UPLOAD_FIELD, UPLOAD_MAX_COUNT);
}
