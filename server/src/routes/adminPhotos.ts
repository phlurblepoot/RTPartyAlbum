import { Router } from 'express';
import type { EventRepo } from '../db/repositories/eventRepo.js';
import type { PhotoRepo } from '../db/repositories/photoRepo.js';

/**
 * Admin photo routes. Mounted under /api/admin. Provides:
 *   GET    /events/:id/photos    -> PhotoAdmin[] (newest-first, incl. device fields)
 *   POST   /photos/:id/hide      -> 204 (Task 8)
 *   DELETE /photos/:id           -> 204 (Task 8)
 */
export function makeAdminPhotosRouter(): Router {
  const router = Router();

  router.get('/events/:id/photos', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const photoRepo = req.app.get('photoRepo') as PhotoRepo;
    const event = eventRepo.getById(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'event not found' });
      return;
    }
    const photos = photoRepo.listForEventAdmin(event.id);
    res.json(photos);
  });

  return router;
}
