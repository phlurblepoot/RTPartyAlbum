import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_THEME_ID, DEFAULT_MOTION_CONFIG } from '@rtpa/shared';
import type { EventRepo } from '../db/repositories/eventRepo.js';
import { generateUniqueCode } from '../services/eventCode.js';

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });
const uploadStateSchema = z.object({ enabled: z.boolean() });

export function makeAdminEventsRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    res.json(eventRepo.list());
  });

  router.post('/', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const code = generateUniqueCode(eventRepo);
    const event = eventRepo.create({
      name: parsed.data.name,
      code,
      themeId: DEFAULT_THEME_ID,
      motionConfig: DEFAULT_MOTION_CONFIG,
    });
    eventRepo.activate(event.id); // pauses others
    res.json(eventRepo.getById(event.id));
  });

  router.get('/:id', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const event = eventRepo.getById(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(event);
  });

  router.post('/:id/activate', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    if (!eventRepo.getById(req.params.id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    eventRepo.activate(req.params.id);
    res.json(eventRepo.getById(req.params.id));
  });

  router.post('/:id/upload-state', (req, res) => {
    const parsed = uploadStateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    if (!eventRepo.getById(req.params.id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    eventRepo.setUploadEnabled(req.params.id, parsed.data.enabled);
    res.json(eventRepo.getById(req.params.id));
  });

  router.post('/:id/end', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    if (!eventRepo.getById(req.params.id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    eventRepo.end(req.params.id);
    res.json(eventRepo.getById(req.params.id));
  });

  return router;
}
