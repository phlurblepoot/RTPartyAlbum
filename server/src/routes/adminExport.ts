import { Router } from 'express';
import type { EventRepo } from '../db/repositories/eventRepo.js';
import type { PhotoRepo } from '../db/repositories/photoRepo.js';
import { streamAlbumZip, type PhotoWithPath } from '../services/exportService.js';

/**
 * Admin export route. Mounted under /api/admin. Provides:
 *   GET /events/:id/export -> application/zip stream of all originals + manifest.json
 */
export function makeAdminExportRouter(): Router {
  const router = Router();

  router.get('/events/:id/export', async (req, res, next) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const photoRepo = req.app.get('photoRepo') as PhotoRepo;

    const event = eventRepo.getById(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const photos = photoRepo.listForEventAdmin(event.id);

    // Augment each PhotoAdmin with its raw filesystem path for archiving.
    // Photos without a resolvable path (e.g. already deleted) are skipped.
    const photosWithPaths: PhotoWithPath[] = [];
    for (const photo of photos) {
      const paths = photoRepo.getPaths(photo.id);
      if (paths) {
        photosWithPaths.push({ ...photo, filePath: paths.filePath });
      }
    }

    const filenameSafe = event.code.replace(/[^a-zA-Z0-9_-]/g, '') || 'album';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="album-${filenameSafe}.zip"`);

    try {
      await streamAlbumZip(photosWithPaths, res);
      // streamAlbumZip pipes to res and resolves on archive end; res ends with the stream.
    } catch (err) {
      if (!res.headersSent) return next(err);
      res.destroy(err as Error);
    }
  });

  return router;
}
