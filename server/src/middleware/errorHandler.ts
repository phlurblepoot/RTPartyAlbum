import type { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';
import { UploadValidationError } from '../services/uploadValidation.js';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

/** 404 handler — must be registered after all routes. */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, 'Not Found'));
}

/** Resolve the HTTP status + client-safe code for a thrown error. */
function classify(err: unknown): { status: number; message: string } {
  if (err instanceof HttpError) {
    return { status: err.status, message: err.message };
  }
  // Multer raises MulterError for limit violations (oversize file, too many files,
  // unexpected field, etc.). Oversize → 413; all other multer limits → 400. This
  // keeps an oversize upload from surfacing as a 500.
  if (err instanceof MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return { status, message: err.code };
  }
  // Upload validation (wrong type / oversize against per-type caps) → 400. The route
  // normally catches this itself, but map it here too in case it reaches the handler.
  if (err instanceof UploadValidationError) {
    return { status: 400, message: err.code };
  }
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return { status: 500, message };
}

/** Terminal JSON error handler — must be registered last. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const { status, message } = classify(err);
  if (status >= 500) {
    // Log the REAL error server-side (sharp/ffmpeg messages can leak filesystem and
    // codec details), but respond with a generic body so we never leak internals.
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(status).json({ error: 'internal_error' });
    return;
  }
  // <500 are our own/known codes — safe to return as-is.
  res.status(status).json({ error: message });
}
