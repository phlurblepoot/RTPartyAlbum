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
    emitPhotoUpdated: vi.fn(),
    emitEventUpdated: vi.fn(),
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

  it('PUT motion rejects negative weight → 400, no broadcast', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const badCfg = {
      ...DEFAULT_MOTION_CONFIG,
      motionWeights: { ...DEFAULT_MOTION_CONFIG.motionWeights, drift: -1 },
    };
    const res = await agent.put(`/api/admin/events/${e.id}/motion`).send({ motionConfig: badCfg });
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

describe('event state broadcasts', () => {
  it('pausing uploads broadcasts event:updated with uploadEnabled false', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    realtime.emitEventUpdated.mockClear();
    await agent.post(`/api/admin/events/${e.id}/upload-state`).send({ enabled: false });
    expect(realtime.emitEventUpdated).toHaveBeenCalledWith(
      e.code,
      expect.objectContaining({ code: e.code, uploadEnabled: false }),
    );
  });

  it('ending an event broadcasts status ended', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    realtime.emitEventUpdated.mockClear();
    await agent.post(`/api/admin/events/${e.id}/end`);
    expect(realtime.emitEventUpdated).toHaveBeenCalledWith(
      e.code,
      expect.objectContaining({ status: 'ended', uploadEnabled: false }),
    );
  });

  it('activating one event also broadcasts the newly paused one', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const a = (await agent.post('/api/admin/events').send({ name: 'A' })).body;
    const b = (await agent.post('/api/admin/events').send({ name: 'B' })).body;
    realtime.emitEventUpdated.mockClear();
    await agent.post(`/api/admin/events/${a.id}/activate`);
    expect(realtime.emitEventUpdated).toHaveBeenCalledWith(a.code, expect.objectContaining({ status: 'active' }));
    expect(realtime.emitEventUpdated).toHaveBeenCalledWith(b.code, expect.objectContaining({ status: 'paused' }));
  });

  it('editing a custom theme re-broadcasts it to events that use it', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const preset = (await agent.get('/api/admin/themes')).body.find(
      (t: { id: string }) => t.id === DEFAULT_THEME_ID,
    );
    const custom = (await agent.post('/api/admin/themes').send({ name: 'Mine', tokens: preset.tokens })).body;
    const used = (await agent.post('/api/admin/events').send({ name: 'Used' })).body;
    const other = (await agent.post('/api/admin/events').send({ name: 'Other' })).body;
    await agent.put(`/api/admin/events/${used.id}/theme`).send({ themeId: custom.id });
    realtime.emitThemeUpdated.mockClear();

    await agent.put(`/api/admin/themes/${custom.id}`).send({ name: 'Mine v2' });
    expect(realtime.emitThemeUpdated).toHaveBeenCalledTimes(1);
    expect(realtime.emitThemeUpdated).toHaveBeenCalledWith(
      used.code,
      expect.objectContaining({ id: custom.id, name: 'Mine v2' }),
    );
    expect(realtime.emitThemeUpdated).not.toHaveBeenCalledWith(other.code, expect.anything());
  });

  it('changing media limits pushes them to open events', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    realtime.emitEventUpdated.mockClear();
    const mediaLimits = { photoMaxBytes: 1_000_000, videoMaxBytes: 2_000_000, videoMaxDurationSec: 10 };
    await agent.put('/api/admin/settings').send({ mediaLimits });
    expect(realtime.emitEventUpdated).toHaveBeenCalledWith(e.code, expect.objectContaining({ mediaLimits }));
  });
});
