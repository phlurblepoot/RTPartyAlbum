import type { RequestHandler } from 'express';
import multer from 'multer';
import { HttpError } from './errorHandler.js';

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
        // Throw a typed HttpError so the terminal error handler maps it to 400
        // (rather than treating an unrecognized fileFilter Error as a 500).
        cb(new HttpError(400, `unsupported mimetype: ${file.mimetype}`));
      }
    },
  });
  return upload.array(UPLOAD_FIELD, UPLOAD_MAX_COUNT);
}
