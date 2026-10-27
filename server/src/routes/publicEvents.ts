import { Router } from 'express';
import type { Application, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { PublicEvent, MediaLimits, Photo, PhotoAdmin, EventDetail } from '@rtpa/shared';
import { DEFAULT_THEME_ID, DEFAULT_MEDIA_LIMITS, SETTINGS_KEYS } from '@rtpa/shared';
import type { EventRepo } from '../db/repositories/eventRepo.js';
import type { ThemeRepo } from '../db/repositories/themeRepo.js';
import type { PhotoRepo } from '../db/repositories/photoRepo.js';
import type { SettingsRepo } from '../db/repositories/settingsRepo.js';
import type { RealtimeEmitters } from '../realtime/realtime.js';
import type { Config } from '../config.js';
import { makeUploadMiddleware, INCOMING_DIRNAME } from '../middleware/upload.js';
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

/** Read the first bytes of a file — enough for magic-byte type detection. */
async function readHead(filePath: string, bytes = 64): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Move a file into place; falls back to copy+delete across filesystems. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}

/** Strip admin-only device fields from a PhotoAdmin row to produce a public Photo. */
export function toPublicPhoto(row: PhotoAdmin): Photo {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deviceId, userAgent, ipAddress, ...pub } = row;
  return pub;
}

/** Build the public-facing event view, resolving the theme (falling back to default). */
export function toPublicEvent(
  event: EventDetail,
  themeRepo: ThemeRepo,
  settingsRepo: SettingsRepo,
): PublicEvent {
  const theme = themeRepo.getById(event.themeId) ?? themeRepo.getById(DEFAULT_THEME_ID)!;
  return {
    code: event.code,
    name: event.name,
    status: event.status,
    uploadEnabled: event.uploadEnabled,
    theme,
    motionConfig: event.motionConfig,
    mediaLimits: getMediaLimits(settingsRepo),
  };
}

/**
 * Broadcast the current public state of each given event to its room, so open
 * upload pages learn about pause/resume/end (and new media limits) without a reload.
 * Unknown ids are skipped.
 */
export function broadcastEventState(app: Application, eventIds: Iterable<string>): void {
  const eventRepo = app.get('eventRepo') as EventRepo;
  const themeRepo = app.get('themeRepo') as ThemeRepo;
  const settingsRepo = app.get('settingsRepo') as SettingsRepo;
  const realtime = app.get('realtime') as RealtimeEmitters;
  for (const id of eventIds) {
    const event = eventRepo.getById(id);
    if (event) realtime.emitEventUpdated(event.code, toPublicEvent(event, themeRepo, settingsRepo));
  }
}

export function makePublicEventsRouter(opts: PublicEventsOptions = {}): Router {
  const router = Router();

  // The currently-active event (for the landing page), or `null` when none is
  // active. Returns 200 with a null body rather than 404 so the client can treat
  // "no active event" as a normal empty state instead of an error.
  router.get('/active', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    const event = eventRepo.getActive();
    res.json(event ? toPublicEvent(event, themeRepo, settingsRepo) : null);
  });

  router.get('/by-code/:code', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    const event = eventRepo.getByCode(req.params.code);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    res.json(toPublicEvent(event, themeRepo, settingsRepo));
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

  // Coarse per-IP pre-limiter. Runs BEFORE multer so a flood is bounded before any
  // body is buffered. Keyed on req.ip ONLY (deviceId isn't parsed yet at this point).
  // Ceiling is well above the per-device limiter so legitimate multi-device traffic
  // from one NAT/IP isn't unduly blocked while still capping abuse.
  const ipPreLimiter = rateLimit({
    windowMs: 60_000,
    // Guests on venue Wi-Fi often share ONE public IP, and the web client sends one
    // request per file, so this must allow a whole room's burst (e.g. right after a
    // toast). The per-device limiter below still caps any single phone at 60/min.
    limit: opts.uploadRateMax ? opts.uploadRateMax * 4 : 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_uploads' },
    keyGenerator: (req) => req.ip ?? 'noip',
  });

  // Cheap rejection gate. Runs FIRST — BEFORE multer receives the body — so an unknown
  // or upload-disabled/ended event is rejected without streaming up to ~1.2GB
  // (20 files × 60MB) to disk first. On success it stashes the resolved event
  // on res.locals so the handler can reuse it without a second getByCode.
  const preUploadGate: RequestHandler = (req, res, next) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
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
    res.locals.event = event;
    next();
  };

  // Multipart parser. Files stream to UPLOADS_DIR/.incoming (same volume as the
  // originals, so they can be renamed into place). The coarse byte cap = max(photo,
  // video) bytes from CURRENT settings; finer per-type caps are enforced afterward by
  // validateUpload against the true received byte count. Build the multer middleware
  // PER REQUEST (cheap config) so a runtime media_limits change takes effect immediately.
  const dynamicUpload: RequestHandler = (req, res, next) => {
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    const config = req.app.get('config') as Config;
    const limits = getMediaLimits(settingsRepo);
    const perFileMax = Math.max(limits.photoMaxBytes, limits.videoMaxBytes);
    makeUploadMiddleware(perFileMax, path.join(config.uploadsDir, INCOMING_DIRNAME))(req, res, next);
  };

  // Whatever happens below, never leave received temp files behind (files that were
  // moved into place are already gone; rm is a no-op for them).
  const cleanupIncoming: RequestHandler = (req, res, next) => {
    res.on('close', () => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      for (const f of files) void fs.rm(f.path, { force: true }).catch(() => undefined);
    });
    next();
  };

  router.post(
    '/by-code/:code/upload',
    preUploadGate, // 404/403 BEFORE buffering — rejects bad/closed targets cheaply
    ipPreLimiter, // coarse per-IP flood bound, also before buffering
    dynamicUpload, // now receives files only for a valid, open event under the IP ceiling
    cleanupIncoming, // temp files are removed when the response finishes
    uploadLimiter, // fine-grained deviceId:ip limiter (needs req.body.deviceId from multer)
    async (req, res, next) => {
      const photoRepo = req.app.get('photoRepo') as PhotoRepo;
      const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
      const realtime = req.app.get('realtime') as RealtimeEmitters;
      const config = req.app.get('config') as Config;

      // Reuse the event resolved by preUploadGate (defense-in-depth fallback below).
      const event = (res.locals.event as EventDetail | undefined) ?? undefined;
      if (!event) {
        // Should not happen (gate runs first), but guard rather than dereference undefined.
        res.status(404).json({ error: 'not_found' });
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
            buffer: await readHead(file.path),
            mimetype: file.mimetype,
            sizeBytes: file.size,
            limits,
          });

          const photoId = nanoid();
          const originalPath = path.join(eventDir, `${photoId}${v.ext}`);
          // Move the received file into place as the original (videoService needs a
          // file PATH, and keeping the original on disk is the storage contract).
          await moveFile(file.path, originalPath);
          pendingOriginal = originalPath;

          if (v.mediaType === 'image') {
            // Only this one image is read into memory, not the whole batch.
            const out = await processImage(await fs.readFile(originalPath), photoId, config.dataDir);
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
