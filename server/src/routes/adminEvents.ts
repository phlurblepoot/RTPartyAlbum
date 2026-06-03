import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { DEFAULT_THEME_ID, DEFAULT_MOTION_CONFIG, SETTINGS_KEYS } from '@rtpa/shared';
import type { EventRepo } from '../db/repositories/eventRepo.js';
import type { ThemeRepo } from '../db/repositories/themeRepo.js';
import type { SettingsRepo } from '../db/repositories/settingsRepo.js';
import type { RealtimeEmitters } from '../realtime/realtime.js';
import { generateUniqueCode } from '../services/eventCode.js';

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });
const uploadStateSchema = z.object({ enabled: z.boolean() });

const motionConfigSchema = z.object({
  motionWeights: z.object({
    drift: z.number().nonnegative(),
    current: z.number().nonnegative(),
    orbit: z.number().nonnegative(),
    mosaic: z.number().nonnegative(),
    sway: z.number().nonnegative(),
    bob: z.number().nonnegative(),
    breathe: z.number().nonnegative(),
  }),
  speed: z.number().min(0.25).max(3),
  maxOnCanvas: z.number().int().positive(),
  dwell: z.object({
    enabled: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    varianceMs: z.number().int().nonnegative(),
  }),
  enterWeights: z.object({
    flyInEdge: z.number().nonnegative(),
    scalePop: z.number().nonnegative(),
    fadeGrow: z.number().nonnegative(),
    spinIn: z.number().nonnegative(),
    dropBounce: z.number().nonnegative(),
  }),
  leaveWeights: z.object({
    driftOffEdge: z.number().nonnegative(),
    shrinkFade: z.number().nonnegative(),
    spinOut: z.number().nonnegative(),
    slideAway: z.number().nonnegative(),
  }),
  baseSize: z.number().positive().max(800),
  sizeVariance: z.number().min(0).max(1),
  tiltMinDeg: z.number().min(-45).max(45),
  tiltMaxDeg: z.number().min(-45).max(45),
});

const motionSchema = z.object({ motionConfig: motionConfigSchema });
const themeUpdateSchema = z.object({ themeId: z.string().min(1) });

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

  router.put('/:id/motion', (req, res) => {
    const parsed = motionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const realtime = req.app.get('realtime') as RealtimeEmitters;
    const event = eventRepo.getById(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    eventRepo.setMotionConfig(req.params.id, parsed.data.motionConfig);
    realtime.emitSettingsUpdated(event.code, parsed.data.motionConfig);
    res.json(eventRepo.getById(req.params.id));
  });

  router.put('/:id/theme', (req, res) => {
    const parsed = themeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    const realtime = req.app.get('realtime') as RealtimeEmitters;
    const event = eventRepo.getById(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const theme = themeRepo.getById(parsed.data.themeId);
    if (!theme) {
      res.status(404).json({ error: 'theme_not_found' });
      return;
    }
    eventRepo.setTheme(req.params.id, theme.id);
    realtime.emitThemeUpdated(event.code, theme);
    res.json(eventRepo.getById(req.params.id));
  });

  router.get('/:id/qr', async (req, res, next) => {
    try {
      const eventRepo = req.app.get('eventRepo') as EventRepo;
      const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
      const event = eventRepo.getById(req.params.id);
      if (!event) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const baseUrl = (settingsRepo.get(SETTINGS_KEYS.publicBaseUrl) ?? '').replace(/\/+$/, '');
      const url = `${baseUrl}/e/${event.code}`;
      const png = await QRCode.toBuffer(url, { type: 'png', width: 512, margin: 2 });
      res.setHeader('Content-Type', 'image/png');
      res.send(png);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
