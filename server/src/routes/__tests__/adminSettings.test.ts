import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { openMemoryDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import { makeSettingsRepo } from '../../db/repositories/settingsRepo.js';
import { makeThemeRepo } from '../../db/repositories/themeRepo.js';
import { DEFAULT_MEDIA_LIMITS } from '@rtpa/shared';

// NOTE: Plan 2 test uses `getDb(':memory:')` and `seed(db, config)`, but the real
// disk API uses `openMemoryDb()` and `seed({ themeRepo, settingsRepo, sessionSecret })`.
// This test uses the real API so it actually runs under vitest.
function ctx() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = openMemoryDb();
  migrate(db);
  const settingsRepo = makeSettingsRepo(db);
  const themeRepo = makeThemeRepo(db);
  seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });
  const app = buildApp({ db, config });
  return { app };
}

async function authed(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return agent;
}

describe('admin settings', () => {
  it('GET returns publicBaseUrl + mediaLimits', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.get('/api/admin/settings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('publicBaseUrl');
    expect(res.body.mediaLimits).toEqual(DEFAULT_MEDIA_LIMITS);
  });

  it('PUT updates publicBaseUrl and mediaLimits', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.put('/api/admin/settings').send({
      publicBaseUrl: 'https://x.example.com',
      mediaLimits: { photoMaxBytes: 1000, videoMaxBytes: 2000, videoMaxDurationSec: 10 },
    });
    expect(res.status).toBe(200);
    expect(res.body.publicBaseUrl).toBe('https://x.example.com');
    expect(res.body.mediaLimits.photoMaxBytes).toBe(1000);
  });

  it('PUT rejects invalid mediaLimits → 400', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.put('/api/admin/settings').send({ mediaLimits: { photoMaxBytes: -5 } });
    expect(res.status).toBe(400);
  });

  it('POST password changes hash when current is correct', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const ok = await agent.post('/api/admin/password').send({ current: 'hunter2', next: 'newpass1' });
    expect(ok.status).toBe(204);
    // old password now fails
    const bad = await request(app).post('/api/admin/login').send({ password: 'hunter2' });
    expect(bad.status).toBe(401);
    const good = await request(app).post('/api/admin/login').send({ password: 'newpass1' });
    expect(good.status).toBe(200);
  });

  it('POST password rejects wrong current → 401', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.post('/api/admin/password').send({ current: 'wrong', next: 'newpass1' });
    expect(res.status).toBe(401);
  });

  it('requires auth for GET settings', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/admin/settings');
    expect(res.status).toBe(401);
  });

  it('requires auth for PUT settings', async () => {
    const { app } = ctx();
    const res = await request(app).put('/api/admin/settings').send({ publicBaseUrl: 'https://x.example.com' });
    expect(res.status).toBe(401);
  });

  it('requires auth for POST password', async () => {
    const { app } = ctx();
    const res = await request(app).post('/api/admin/password').send({ current: 'hunter2', next: 'newpass1' });
    expect(res.status).toBe(401);
  });
});
