import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { openMemoryDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import { makeSettingsRepo } from '../../db/repositories/settingsRepo.js';
import { makeThemeRepo } from '../../db/repositories/themeRepo.js';
import { DEFAULT_MOTION_CONFIG, DEFAULT_THEME_ID } from '@rtpa/shared';

// NOTE: Plan 2 test used `getDb(':memory:')` and `seed(db, config)`, but the real
// disk API uses `openMemoryDb()` and `seed({ themeRepo, settingsRepo })`.
// This test uses the real API so it actually runs under vitest.
function ctx() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = openMemoryDb();
  migrate(db);
  const settingsRepo = makeSettingsRepo(db);
  const themeRepo = makeThemeRepo(db);
  seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });
  const realtime = {
    emitPhotoAdded: vi.fn(),
    emitPhotoHidden: vi.fn(),
    emitPhotoDeleted: vi.fn(),
    emitSettingsUpdated: vi.fn(),
    emitThemeUpdated: vi.fn(),
  };
  const app = buildApp({ db, config, realtime });
  return { app, realtime };
}

async function authed(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return agent;
}

describe('motion + theme update broadcasts', () => {
  it('PUT motion validates, persists, and broadcasts settings:updated with the code', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const newCfg = { ...DEFAULT_MOTION_CONFIG, speed: 2, maxOnCanvas: 30 };
    const res = await agent.put(`/api/admin/events/${e.id}/motion`).send({ motionConfig: newCfg });
    expect(res.status).toBe(200);
    expect(res.body.motionConfig.speed).toBe(2);
    expect(realtime.emitSettingsUpdated).toHaveBeenCalledWith(e.code, expect.objectContaining({ speed: 2 }));
  });

  it('PUT motion rejects invalid config → 400, no broadcast', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const res = await agent.put(`/api/admin/events/${e.id}/motion`).send({ motionConfig: { speed: 'fast' } });
    expect(res.status).toBe(400);
    expect(realtime.emitSettingsUpdated).not.toHaveBeenCalled();
  });

  it('PUT motion on missing event → 404', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.put('/api/admin/events/no-such-id/motion').send({ motionConfig: DEFAULT_MOTION_CONFIG });
    expect(res.status).toBe(404);
  });

  it('PUT theme persists and broadcasts theme:updated', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const res = await agent.put(`/api/admin/events/${e.id}/theme`).send({ themeId: DEFAULT_THEME_ID });
    expect(res.status).toBe(200);
    expect(res.body.themeId).toBe(DEFAULT_THEME_ID);
    expect(realtime.emitThemeUpdated).toHaveBeenCalledWith(e.code, expect.objectContaining({ id: DEFAULT_THEME_ID }));
  });

  it('PUT theme with unknown themeId → 404', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const res = await agent.put(`/api/admin/events/${e.id}/theme`).send({ themeId: 'no-such-theme' });
    expect(res.status).toBe(404);
  });

  it('PUT theme on missing event → 404', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.put('/api/admin/events/no-such-id/theme').send({ themeId: DEFAULT_THEME_ID });
    expect(res.status).toBe(404);
  });
});
