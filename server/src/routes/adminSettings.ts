import { Router } from 'express';
import { z } from 'zod';
import { SETTINGS_KEYS, DEFAULT_MEDIA_LIMITS, type MediaLimits } from '@rtpa/shared';
import type { SettingsRepo } from '../db/repositories/settingsRepo.js';
import { verifyPassword, setAdminPassword } from '../auth/auth.js';

const mediaLimitsSchema = z.object({
  photoMaxBytes: z.number().int().positive(),
  videoMaxBytes: z.number().int().positive(),
  videoMaxDurationSec: z.number().int().positive(),
});

const updateSchema = z.object({
  publicBaseUrl: z.string().url().or(z.literal('')).optional(),
  mediaLimits: mediaLimitsSchema.optional(),
});

const passwordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(6),
});

function readSettings(settingsRepo: SettingsRepo) {
  const publicBaseUrl = settingsRepo.get(SETTINGS_KEYS.publicBaseUrl) ?? '';
  const mediaLimits =
    settingsRepo.getJson<MediaLimits>(SETTINGS_KEYS.mediaLimits) ?? DEFAULT_MEDIA_LIMITS;
  return { publicBaseUrl, mediaLimits };
}

export function makeAdminSettingsRouter(): Router {
  const router = Router();

  router.get('/settings', (req, res) => {
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    res.json(readSettings(settingsRepo));
  });

  router.put('/settings', (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    if (parsed.data.publicBaseUrl !== undefined) {
      settingsRepo.set(SETTINGS_KEYS.publicBaseUrl, parsed.data.publicBaseUrl);
    }
    if (parsed.data.mediaLimits !== undefined) {
      settingsRepo.setJson(SETTINGS_KEYS.mediaLimits, parsed.data.mediaLimits);
    }
    res.json(readSettings(settingsRepo));
  });

  router.post('/password', (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    if (!verifyPassword(settingsRepo, parsed.data.current)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    setAdminPassword(settingsRepo, parsed.data.next);
    res.status(204).end();
  });

  return router;
}
