import { Router } from 'express';
import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { PublicEvent, MediaLimits, Photo, PhotoAdmin } from '@rtpa/shared';
import { DEFAULT_THEME_ID, DEFAULT_MEDIA_LIMITS, SETTINGS_KEYS } from '@rtpa/shared';
import type { EventRepo } from '../db/repositories/eventRepo.js';
import type { ThemeRepo } from '../db/repositories/themeRepo.js';
import type { PhotoRepo } from '../db/repositories/photoRepo.js';
import type { SettingsRepo } from '../db/repositories/settingsRepo.js';
import type { RealtimeEmitters } from '../realtime/realtime.js';
import type { Config } from '../config.js';
import { makeUploadMiddleware } from '../middleware/upload.js';
import { validateUpload, UploadValidationError } from '../services/uploadValidation.js';
import { processImage } from '../services/imageService.js';
import { processVideo } from '../services/videoService.js';

export interface PublicEventsOptions {
  /** Override the per-window upload limit (used by tests to force 429 quickly). */
  uploadRateMax?: number;
}

/** Resolve current media limits from settings, falling back to defaults. */
function getMediaLimits(settingsRepo: SettingsRepo): MediaLimits {
  return settingsRepo.getJson<MediaLimits>(SETTINGS_KEYS.mediaLimits) ?? DEFAULT_MEDIA_LIMITS;
}

/** Strip admin-only device fields from a PhotoAdmin row to produce a public Photo. */
function toPublicPhoto(row: PhotoAdmin): Photo {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deviceId, userAgent, ipAddress, ...pub } = row;
  return pub;
}

export function makePublicEventsRouter(opts: PublicEventsOptions = {}): Router {
  const router = Router();

  router.get('/by-code/:code', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    const event = eventRepo.getByCode(req.params.code);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const theme = themeRepo.getById(event.themeId) ?? themeRepo.getById(DEFAULT_THEME_ID)!;
    const publicEvent: PublicEvent = {
      code: event.code,
      name: event.name,
      status: event.status,
      uploadEnabled: event.uploadEnabled,
      theme,
      motionConfig: event.motionConfig,
    };
    res.json(publicEvent);
  });

  router.get('/by-code/:code/photos', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const photoRepo = req.app.get('photoRepo') as PhotoRepo;
    const event = eventRepo.getByCode(req.params.code);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(photoRepo.listForEventPublic(event.id));
  });

  // ---- Upload (Plan 3, Task 6) ----

  // Per-router so each app instance gets isolated rate-limit state (no cross-test bleed).
  const uploadLimiter = rateLimit({
    windowMs: 60_000,
    limit: opts.uploadRateMax ?? 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_uploads' },
    // Key by deviceId + client IP. deviceId is parsed by the upload middleware
    // (which runs first), so req.body.deviceId is populated here.
    keyGenerator: (req) => {
      const deviceId =
        typeof req.body?.deviceId === 'string' && req.body.deviceId ? req.body.deviceId : 'nodevice';
      return `${deviceId}:${req.ip}`;
    },
  });

  // Multipart parser. The coarse byte cap = max(photo, video) bytes from CURRENT
  // settings; finer per-type caps are enforced afterward by validateUpload against the
  // true received byte count. Build the multer middleware PER REQUEST (cheap, pure
  // config, no I/O) so a runtime media_limits change takes effect immediately — a cached
  // middleware would keep a stale cap and let oversized files buffer fully into memory.
  const dynamicUpload: RequestHandler = (req, res, next) => {
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    const limits = getMediaLimits(settingsRepo);
    const perFileMax = Math.max(limits.photoMaxBytes, limits.videoMaxBytes);
    makeUploadMiddleware(perFileMax)(req, res, next);
  };

  router.post(
    '/by-code/:code/upload',
    dynamicUpload, // parse multipart first so req.body.deviceId exists for the limiter
    uploadLimiter,
    async (req, res, next) => {
      const eventRepo = req.app.get('eventRepo') as EventRepo;
      const photoRepo = req.app.get('photoRepo') as PhotoRepo;
      const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
      const realtime = req.app.get('realtime') as RealtimeEmitters;
      const config = req.app.get('config') as Config;

      const code = req.params.code ?? '';
      const event = eventRepo.getByCode(code);
      if (!event) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (event.status === 'ended' || !event.uploadEnabled) {
        res.status(403).json({ error: 'uploads_closed' });
        return;
      }

      const uploaderRaw = typeof req.body?.uploaderName === 'string' ? req.body.uploaderName.trim() : '';
      const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
      if (!uploaderRaw) {
        res.status(400).json({ error: 'uploader_name_required' });
        return;
      }
      if (!deviceId) {
        res.status(400).json({ error: 'device_id_required' });
        return;
      }
      const uploaderName = uploaderRaw.slice(0, 80);

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: 'no_files' });
        return;
      }

      const userAgent = req.get('user-agent') ?? '';
      const ipAddress = req.ip ?? '';
      const limits = getMediaLimits(settingsRepo);

      const eventDir = path.join(config.uploadsDir, event.id);
      await fs.mkdir(eventDir, { recursive: true });

      // The batch is all-or-nothing: if any file fails, we roll back EVERY artifact
      // produced so far in this request — DB rows AND files (original + derived) — so a
      // mid-batch failure never leaves orphan rows or files behind. We also only emit
      // photo:added after the whole batch succeeds.
      const created: Photo[] = [];
      const persisted: Array<{ rowId: string; originalPath: string; displayPath: string; thumbPath: string }> = [];
      // An original written but not yet persisted as a row (failure between write and create).
      let pendingOriginal: string | null = null;

      try {
        for (const file of files) {
          // Validate against TRUE received bytes (file.size), not Content-Length.
          // A bad/oversize/wrong-type file rejects the WHOLE request (UploadValidationError
          // → 400 below); we do not silently skip so the uploader gets clear feedback.
          const v = validateUpload({
            buffer: file.buffer,
            mimetype: file.mimetype,
            sizeBytes: file.size,
            limits,
          });

          const photoId = nanoid();
          const originalPath = path.join(eventDir, `${photoId}${v.ext}`);
          // Write the original first (images and videos): videoService needs a file PATH,
          // and keeping the original on disk is the storage contract.
          await fs.writeFile(originalPath, file.buffer);
          pendingOriginal = originalPath;

          if (v.mediaType === 'image') {
            const out = await processImage(file.buffer, photoId, config.dataDir);
            const row = photoRepo.create({
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
            persisted.push({ rowId: row.id, originalPath, displayPath: out.displayPath, thumbPath: out.thumbPath });
            pendingOriginal = null;
            created.push(toPublicPhoto(row));
          } else {
            const out = await processVideo(
              originalPath,
              photoId,
              config.dataDir,
              limits.videoMaxDurationSec,
            );
            const row = photoRepo.create({
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
            persisted.push({ rowId: row.id, originalPath, displayPath: out.displayPath, thumbPath: out.thumbPath });
            pendingOriginal = null;
            created.push(toPublicPhoto(row));
          }
        }
      } catch (err) {
        // Roll back the ENTIRE batch: delete every persisted row and its files, plus the
        // in-flight original that failed before a row was created. processImage/processVideo
        // already remove their own partial derived outputs, but we force-remove here too so
        // cleanup is idempotent regardless of where the failure happened.
        const rmFile = (p: string) => fs.rm(p, { force: true }).catch(() => undefined);
        for (const a of persisted) {
          try {
            photoRepo.remove(a.rowId);
          } catch {
            // best-effort row removal; continue cleaning files
          }
        }
        await Promise.all([
          ...persisted.flatMap((a) => [rmFile(a.originalPath), rmFile(a.displayPath), rmFile(a.thumbPath)]),
          ...(pendingOriginal ? [rmFile(pendingOriginal)] : []),
        ]);
        if (err instanceof UploadValidationError) {
          res.status(400).json({ error: err.code });
          return;
        }
        // Unexpected processing failure (sharp/ffmpeg) on an otherwise-valid file.
        // Surface to the error handler, which masks 5xx bodies and logs the real error.
        next(err);
        return;
      }

      // Broadcast the PUBLIC photos (no device fields) and respond with Photo[].
      for (const p of created) realtime.emitPhotoAdded(event.code, p);
      res.status(201).json(created);
    },
  );

  return router;
}
