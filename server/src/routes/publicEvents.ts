import { Router } from 'express';
import type { PublicEvent } from '@rtpa/shared';
import { DEFAULT_THEME_ID } from '@rtpa/shared';
import type { EventRepo } from '../db/repositories/eventRepo.js';
import type { ThemeRepo } from '../db/repositories/themeRepo.js';
import type { PhotoRepo } from '../db/repositories/photoRepo.js';

export function makePublicEventsRouter(): Router {
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

  return router;
}
