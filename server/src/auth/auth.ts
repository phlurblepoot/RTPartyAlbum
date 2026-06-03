import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { SETTINGS_KEYS } from '@rtpa/shared';
import type { Config } from '../config.js';
import type { SettingsRepo } from '../db/repositories/settingsRepo.js';

export const SESSION_COOKIE = 'rtpa_session';
const SESSION_TTL = '7d';

function sessionSecret(settingsRepo: SettingsRepo): string {
  const secret = settingsRepo.get(SETTINGS_KEYS.sessionSecret);
  if (!secret) throw new Error('session secret missing');
  return secret;
}

/** Hash plaintext into a bcrypt hash and store it as the admin password hash. */
export function setAdminPassword(settingsRepo: SettingsRepo, plaintext: string): void {
  const hash = bcrypt.hashSync(plaintext, 10);
  settingsRepo.set(SETTINGS_KEYS.adminPasswordHash, hash);
}

/** Bootstrap admin_password_hash from config.adminPassword on first run if absent. */
export function ensureAdminBootstrap(settingsRepo: SettingsRepo, config: Config): void {
  const existing = settingsRepo.get(SETTINGS_KEYS.adminPasswordHash);
  if (existing && existing.length > 0) return;
  if (!config.adminPassword) return;
  setAdminPassword(settingsRepo, config.adminPassword);
}

/** Verify a plaintext password against the stored bcrypt hash. */
export function verifyPassword(settingsRepo: SettingsRepo, plaintext: string): boolean {
  const hash = settingsRepo.get(SETTINGS_KEYS.adminPasswordHash);
  if (!hash) return false;
  return bcrypt.compareSync(plaintext, hash);
}

/** Sign a JWT session token using the settings session secret. */
export function signSession(settingsRepo: SettingsRepo): string {
  return jwt.sign({ role: 'admin' }, sessionSecret(settingsRepo), { expiresIn: SESSION_TTL });
}

/** Verify a JWT session token; returns true if valid. */
export function verifySession(settingsRepo: SettingsRepo, token: string): boolean {
  try {
    jwt.verify(token, sessionSecret(settingsRepo));
    return true;
  } catch {
    return false;
  }
}

/** Express middleware: requires a valid rtpa_session cookie. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
  if (!token || !verifySession(settingsRepo, token)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
