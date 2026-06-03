import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { openMemoryDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import { makeSettingsRepo } from '../../db/repositories/settingsRepo.js';
import { makeThemeRepo } from '../../db/repositories/themeRepo.js';
import { DEFAULT_THEME_ID } from '@rtpa/shared';

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

async function createEvent(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return (await agent.post('/api/admin/events').send({ name: 'Public E' })).body;
}

describe('public events read', () => {
  it('GET by-code returns PublicEvent with theme + motionConfig (no auth)', async () => {
    const { app } = ctx();
    const e = await createEvent(app);
    const res = await request(app).get(`/api/events/by-code/${e.code}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(e.code);
    expect(res.body.name).toBe('Public E');
    expect(res.body.uploadEnabled).toBe(true);
    expect(res.body.theme.id).toBe(DEFAULT_THEME_ID);
    expect(res.body.motionConfig).toBeTruthy();
    expect(res.body).not.toHaveProperty('id'); // PublicEvent shape, no internal id
  });

  it('GET /active returns null when no event is active', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/events/active');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('GET /active returns the active event (no auth) with PublicEvent shape', async () => {
    const { app } = ctx();
    const e = await createEvent(app); // create activates it
    const res = await request(app).get('/api/events/active');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(e.code);
    expect(res.body.name).toBe('Public E');
    expect(res.body.theme.id).toBe(DEFAULT_THEME_ID);
    expect(res.body.motionConfig).toBeTruthy();
    expect(res.body).not.toHaveProperty('id'); // PublicEvent shape, no internal id
  });

  it('GET /active follows the most recently activated event', async () => {
    const { app } = ctx();
    await createEvent(app); // first event, becomes active
    const second = await createEvent(app); // activating the second pauses the first
    const res = await request(app).get('/api/events/active');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(second.code);
  });

  it('GET by-code 404 for unknown code', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/events/by-code/zzzzzz');
    expect(res.status).toBe(404);
  });

  it('GET by-code photos returns an array (empty until Plan 3)', async () => {
    const { app } = ctx();
    const e = await createEvent(app);
    const res = await request(app).get(`/api/events/by-code/${e.code}/photos`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('GET by-code photos 404 for unknown code', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/events/by-code/zzzzzz/photos');
    expect(res.status).toBe(404);
  });
});
