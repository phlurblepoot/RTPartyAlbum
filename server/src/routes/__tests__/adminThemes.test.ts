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

async function authed(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return agent;
}

const tokens = {
  background: { type: 'solid', value: '#101015' },
  ambient: 'glow',
  frame: { style: 'rounded', borderColor: '#fff', borderWidth: 2, radius: 12, shadow: true },
  caption: { enabled: true, bg: '#000', color: '#fff' },
  font: 'Inter',
  accent: '#e0b',
};

describe('admin themes CRUD', () => {
  it('lists seeded preset themes', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.get('/api/admin/themes');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(9);
  });

  it('creates a custom theme (isPreset false)', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.post('/api/admin/themes').send({ name: 'My Theme', tokens });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('My Theme');
    expect(res.body.isPreset).toBe(false);
    expect(res.body.id).toBeTruthy();
  });

  it('updates a custom theme', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const created = (await agent.post('/api/admin/themes').send({ name: 'A', tokens })).body;
    const res = await agent.put(`/api/admin/themes/${created.id}`).send({ name: 'B' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('B');
  });

  it('deletes a custom theme → 204', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const created = (await agent.post('/api/admin/themes').send({ name: 'Del', tokens })).body;
    const res = await agent.delete(`/api/admin/themes/${created.id}`);
    expect(res.status).toBe(204);
  });

  it('refuses to edit a preset → 409 and leaves it unchanged', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const before = (await agent.get('/api/admin/themes')).body.find(
      (t: { id: string }) => t.id === DEFAULT_THEME_ID,
    );
    const res = await agent.put(`/api/admin/themes/${DEFAULT_THEME_ID}`).send({ name: 'Hacked' });
    expect(res.status).toBe(409);
    const after = (await agent.get('/api/admin/themes')).body.find(
      (t: { id: string }) => t.id === DEFAULT_THEME_ID,
    );
    expect(after.name).toBe(before.name);
    expect(after.name).not.toBe('Hacked');
  });

  it('rejects an over-long name (121 chars) on create → 400', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent
      .post('/api/admin/themes')
      .send({ name: 'x'.repeat(121), tokens });
    expect(res.status).toBe(400);
  });

  it('refuses to delete a preset → 409', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.delete(`/api/admin/themes/${DEFAULT_THEME_ID}`);
    expect(res.status).toBe(409);
  });

  it('returns 404 for missing theme delete', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.delete('/api/admin/themes/no-such-id');
    expect(res.status).toBe(404);
  });

  it('returns 400 for malformed tokens on create', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.post('/api/admin/themes').send({ name: 'Bad', tokens: { ambient: 'invalid-value' } });
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/admin/themes');
    expect(res.status).toBe(401);
  });
});
