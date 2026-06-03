import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { SETTINGS_KEYS } from '@rtpa/shared';
import { loadConfig } from '../../config.js';
import { openMemoryDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import { makeThemeRepo } from '../../db/repositories/themeRepo.js';
import { makeSettingsRepo } from '../../db/repositories/settingsRepo.js';
import {
  signSession,
  verifySession,
  ensureAdminBootstrap,
  requireAuth,
} from '../auth.js';

function freshDb() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = openMemoryDb();
  migrate(db);
  const themeRepo = makeThemeRepo(db);
  const settingsRepo = makeSettingsRepo(db);
  seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });
  return { db, config, settingsRepo };
}

describe('auth core', () => {
  it('signs and verifies a session token', () => {
    const { settingsRepo } = freshDb();
    const token = signSession(settingsRepo);
    expect(typeof token).toBe('string');
    expect(verifySession(settingsRepo, token)).toBe(true);
    expect(verifySession(settingsRepo, token + 'tamper')).toBe(false);
    expect(verifySession(settingsRepo, 'not-a-jwt')).toBe(false);
  });

  it('bootstraps admin_password_hash from config on first run if absent', () => {
    const { settingsRepo, config } = freshDb();
    settingsRepo.set(SETTINGS_KEYS.adminPasswordHash, '');
    ensureAdminBootstrap(settingsRepo, config);
    const hash = settingsRepo.get(SETTINGS_KEYS.adminPasswordHash);
    expect(hash).toBeTruthy();
    expect(hash).not.toBe('hunter2'); // hashed, not plaintext
  });

  it('does not overwrite an existing hash on bootstrap', () => {
    const { settingsRepo, config } = freshDb();
    settingsRepo.set(SETTINGS_KEYS.adminPasswordHash, 'EXISTING_HASH');
    ensureAdminBootstrap(settingsRepo, config);
    expect(settingsRepo.get(SETTINGS_KEYS.adminPasswordHash)).toBe('EXISTING_HASH');
  });

  it('requireAuth allows with valid cookie and denies without', async () => {
    const { settingsRepo } = freshDb();
    const app = express();
    app.use(cookieParser());
    app.set('settingsRepo', settingsRepo);
    app.get('/protected', requireAuth, (_req, res) => res.json({ ok: true }));

    const token = signSession(settingsRepo);
    const denied = await request(app).get('/protected');
    expect(denied.status).toBe(401);

    const allowed = await request(app)
      .get('/protected')
      .set('Cookie', [`rtpa_session=${token}`]);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ ok: true });
  });
});
