import { Router } from 'express';
import { promises as fsp } from 'node:fs';
import type { EventRepo } from '../db/repositories/eventRepo.js';
import type { PhotoRepo } from '../db/repositories/photoRepo.js';
import type { RealtimeEmitters } from '../realtime/realtime.js';
import { toPublicPhoto } from './publicEvents.js';

/**
 * Admin photo routes. Mounted under /api/admin. Provides:
 *   GET    /events/:id/photos    -> PhotoAdmin[] (newest-first, incl. device fields)
 *   POST   /photos/:id/hide      -> 204 (broadcast photo:hidden or photo:added)
 *   DELETE /photos/:id           -> 204 (delete files; broadcast photo:deleted)
 */
export function makeAdminPhotosRouter(): Router {
  const router = Router();

  router.get('/events/:id/photos', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const photoRepo = req.app.get('photoRepo') as PhotoRepo;
    const event = eventRepo.getById(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const photos = photoRepo.listForEventAdmin(event.id);
    res.json(photos);
  });

  router.post('/photos/:id/hide', (req, res) => {
    const photoRepo = req.app.get('photoRepo') as PhotoRepo;
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const realtime = req.app.get('realtime') as RealtimeEmitters;

    // Require an explicit boolean. A missing/typo'd/string field must NOT silently
    // coerce to false (which would unhide the photo) — reject as a bad request.
    if (typeof req.body?.hidden !== 'boolean') {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const hidden = req.body.hidden;

    const photo = photoRepo.getById(req.params.id);
    if (!photo) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    photoRepo.setHidden(photo.id, hidden);

    const event = eventRepo.getById(photo.eventId);
    if (event) {
      if (hidden) {
        realtime.emitPhotoHidden(event.code, photo.id);
      } else {
        const fresh = photoRepo.getById(photo.id);
        if (fresh) realtime.emitPhotoAdded(event.code, toPublicPhoto(fresh));
      }
    }

    res.status(204).end();
  });

  router.delete('/photos/:id', async (req, res, next) => {
    const photoRepo = req.app.get('photoRepo') as PhotoRepo;
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const realtime = req.app.get('realtime') as RealtimeEmitters;

    const photo = photoRepo.getById(req.params.id);
    if (!photo) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const event = eventRepo.getById(photo.eventId);
    const paths = photoRepo.getPaths(req.params.id);

    try {
      if (paths) {
        await Promise.all(
          [paths.filePath, paths.displayPath, paths.thumbPath].map((p) =>
            fsp.rm(p, { force: true }).catch(() => undefined),
          ),
        );
      }
    } catch (err) {
      next(err);
      return;
    }

    photoRepo.remove(photo.id);

    if (event) {
      realtime.emitPhotoDeleted(event.code, photo.id);
    }

    res.status(204).end();
  });

  return router;
}
