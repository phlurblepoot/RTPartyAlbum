import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { openMemoryDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import { makeSettingsRepo } from '../../db/repositories/settingsRepo.js';
import { makeThemeRepo } from '../../db/repositories/themeRepo.js';
import { DEFAULT_THEME_ID, DEFAULT_MOTION_CONFIG } from '@rtpa/shared';

// NOTE: Plan 2 test used `getDb(':memory:')` and `seed(db, config)`, but the real
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

async function authedAgent(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return agent;
}

describe('admin events routes', () => {
  it('requires auth', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/admin/events');
    expect(res.status).toBe(401);
  });

  it('creates an event with defaults, generated code, and active status', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const res = await agent.post('/api/admin/events').send({ name: 'Sara Birthday' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Sara Birthday');
    expect(res.body.code).toMatch(/^[0-9a-z]{6}$/);
    expect(res.body.themeId).toBe(DEFAULT_THEME_ID);
    expect(res.body.motionConfig).toEqual(DEFAULT_MOTION_CONFIG);
    expect(res.body.isActive).toBe(true);
    expect(res.body.status).toBe('active');
  });

  it('rejects create with invalid body (zod) → 400', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const res = await agent.post('/api/admin/events').send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('lists events newest-first', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    await agent.post('/api/admin/events').send({ name: 'First' });
    await agent.post('/api/admin/events').send({ name: 'Second' });
    const res = await agent.get('/api/admin/events');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Second');
  });

  it('GET :id returns the event detail; 404 for unknown', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const created = await agent.post('/api/admin/events').send({ name: 'X' });
    const ok = await agent.get(`/api/admin/events/${created.body.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(created.body.id);
    const missing = await agent.get('/api/admin/events/nope');
    expect(missing.status).toBe(404);
  });

  it('activate pauses the previously-active event', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const a = await agent.post('/api/admin/events').send({ name: 'A' });
    const b = await agent.post('/api/admin/events').send({ name: 'B' }); // B now active
    const reA = await agent.post(`/api/admin/events/${a.body.id}/activate`);
    expect(reA.status).toBe(200);
    expect(reA.body.isActive).toBe(true);
    const bAfter = await agent.get(`/api/admin/events/${b.body.id}`);
    expect(bAfter.body.isActive).toBe(false);
    expect(bAfter.body.status).toBe('paused');
  });

  it('upload-state toggles upload_enabled', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const e = await agent.post('/api/admin/events').send({ name: 'E' });
    const res = await agent.post(`/api/admin/events/${e.body.id}/upload-state`).send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.uploadEnabled).toBe(false);
  });

  it('end sets status ended and disables uploads', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const e = await agent.post('/api/admin/events').send({ name: 'E' });
    const res = await agent.post(`/api/admin/events/${e.body.id}/end`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ended');
    expect(res.body.isActive).toBe(false);
    expect(res.body.uploadEnabled).toBe(false);
  });

  it('normalizes a pre-upgrade motion config (missing new fields) so saving still works', async () => {
    // Build with direct db access to simulate an event stored before new config
    // fields existed (tiltMinDeg/tiltMaxDeg, sway/bob/breathe weights).
    const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
    const db = openMemoryDb();
    migrate(db);
    const settingsRepo = makeSettingsRepo(db);
    const themeRepo = makeThemeRepo(db);
    seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });
    const app = buildApp({ db, config });
    const agent = await authedAgent(app);

    const created = (await agent.post('/api/admin/events').send({ name: 'Legacy' })).body;

    // Overwrite with an OLD-shaped config (no tilt fields, only the original 4 weights).
    const oldConfig = {
      motionWeights: { drift: 5, current: 2, orbit: 1, mosaic: 2 },
      speed: 1,
      maxOnCanvas: 24,
      dwell: { enabled: true, durationMs: 45000, varianceMs: 15000 },
      enterWeights: { flyInEdge: 3, scalePop: 2, fadeGrow: 2, spinIn: 1, dropBounce: 2 },
      leaveWeights: { driftOffEdge: 3, shrinkFade: 3, spinOut: 1, slideAway: 2 },
      baseSize: 220,
      sizeVariance: 0.4,
    };
    db.prepare('UPDATE events SET motion_config = ? WHERE id = ?').run(
      JSON.stringify(oldConfig),
      created.id,
    );

    // Reading the event backfills the missing fields from defaults.
    const got = (await agent.get(`/api/admin/events/${created.id}`)).body;
    expect(got.motionConfig.tiltMinDeg).toBe(-8);
    expect(got.motionConfig.tiltMaxDeg).toBe(8);
    expect(got.motionConfig.motionWeights.sway).toBeGreaterThanOrEqual(0);
    expect(got.motionConfig.motionWeights.bob).toBeGreaterThanOrEqual(0);
    expect(got.motionConfig.motionWeights.breathe).toBeGreaterThanOrEqual(0);

    // Saving a change built from the loaded config now passes validation (no 400).
    const put = await agent
      .put(`/api/admin/events/${created.id}/motion`)
      .send({ motionConfig: { ...got.motionConfig, speed: 2 } });
    expect(put.status).toBe(200);
    expect(put.body.motionConfig.speed).toBe(2);
  });
});
