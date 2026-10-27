import { describe, it, expect, vi, afterEach } from 'vitest';
import QRCode from 'qrcode';
import request from 'supertest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { openMemoryDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import { makeSettingsRepo } from '../../db/repositories/settingsRepo.js';
import { makeThemeRepo } from '../../db/repositories/themeRepo.js';
import { SETTINGS_KEYS } from '@rtpa/shared';

// Plan 2 snippet used `getDb(':memory:')` and `seed(db, config)`, but real disk API
// uses `openMemoryDb()` and `seed({ themeRepo, settingsRepo, sessionSecret })`.
function ctx(baseUrl = 'https://party.example.com') {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = openMemoryDb();
  migrate(db);
  const settingsRepo = makeSettingsRepo(db);
  const themeRepo = makeThemeRepo(db);
  seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });
  settingsRepo.set(SETTINGS_KEYS.publicBaseUrl, baseUrl);
  return { app: buildApp({ db, config }) };
}

async function authed(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return agent;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QR route', () => {
  it('encodes the configured public base URL', async () => {
    const spy = vi.spyOn(QRCode, 'toBuffer');
    const { app } = ctx('https://party.example.com/');
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    await agent.get(`/api/admin/events/${e.id}/qr`);
    expect(spy.mock.calls[0][0]).toBe(`https://party.example.com/e/${e.code}`);
  });

  it('falls back to the request origin when no base URL is set (never a bare path)', async () => {
    const spy = vi.spyOn(QRCode, 'toBuffer');
    const { app } = ctx('');
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    await agent
      .get(`/api/admin/events/${e.id}/qr`)
      .set('Host', 'party.lan:8080')
      .set('X-Forwarded-Proto', 'https');
    expect(spy.mock.calls[0][0]).toBe(`https://party.lan:8080/e/${e.code}`);
  });

  it('returns a PNG image for an existing event', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const res = await agent.get(`/api/admin/events/${e.id}/qr`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    // Buffer from supertest is a Buffer; check it is non-empty and starts with PNG magic bytes
    expect(res.body.length).toBeGreaterThan(0);
    // PNG magic: 0x89 0x50 0x4E 0x47
    expect(res.body[0]).toBe(0x89);
    expect(res.body[1]).toBe(0x50); // 'P'
    expect(res.body[2]).toBe(0x4e); // 'N'
    expect(res.body[3]).toBe(0x47); // 'G'
  });

  it('404s for a missing event', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.get('/api/admin/events/nope/qr');
    expect(res.status).toBe(404);
  });

  it('requires auth (unauthenticated request → 401)', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/admin/events/some-id/qr');
    expect(res.status).toBe(401);
  });
});
