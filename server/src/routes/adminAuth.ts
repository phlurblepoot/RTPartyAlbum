import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  signSession,
  verifyPassword,
  requireAuth,
} from '../auth/auth.js';
import type { SettingsRepo } from '../db/repositories/settingsRepo.js';

const loginSchema = z.object({ password: z.string().min(1) });

export function makeAdminAuthRouter(): Router {
  const router = Router();

  // Created per-router so each app instance gets its own isolated limiter state
  // (avoids cross-app/cross-test bleed of the rate-limit window).
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too_many_attempts' },
  });

  router.post('/login', loginLimiter, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    if (!verifyPassword(settingsRepo, parsed.data.password)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    const token = signSession(settingsRepo);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.app.get('env') === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.status(200).json({ ok: true });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return router;
}
