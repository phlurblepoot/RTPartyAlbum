import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { openMemoryDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import { makeSettingsRepo } from '../../db/repositories/settingsRepo.js';
import { makeThemeRepo } from '../../db/repositories/themeRepo.js';

// NOTE: Plan 2 test uses `getDb(':memory:')` and `seed(db, config)`, but the real
// disk API uses `openMemoryDb()` and `seed({ themeRepo, settingsRepo, sessionSecret })`.
// This test uses the real API so it actually runs under vitest.
function makeApp() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = openMemoryDb();
  migrate(db);
  const settingsRepo = makeSettingsRepo(db);
  const themeRepo = makeThemeRepo(db);
  seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });
  return buildApp({ db, config });
}

describe('admin auth routes', () => {
  it('rejects wrong password with 401', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/admin/login').send({ password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('accepts right password and sets rtpa_session cookie', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/admin/login').send({ password: 'hunter2' });
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('rtpa_session='))).toBe(true);
    expect(cookies.some((c) => c.toLowerCase().includes('httponly'))).toBe(true);
  });

  it('GET /me returns 401 without cookie and 200 with cookie', async () => {
    const app = makeApp();
    const noCookie = await request(app).get('/api/admin/me');
    expect(noCookie.status).toBe(401);

    const login = await request(app).post('/api/admin/login').send({ password: 'hunter2' });
    const cookie = login.headers['set-cookie'] as unknown as string[];
    const me = await request(app).get('/api/admin/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ ok: true });
  });

  it('logout returns 204 and clears the cookie', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/admin/logout');
    expect(res.status).toBe(204);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    // clearCookie emits an expired rtpa_session cookie (Expires epoch / Max-Age=0).
    const cleared = cookies.find((c) => c.startsWith('rtpa_session='));
    expect(cleared).toBeDefined();
    expect(/expires=thu, 01 jan 1970|max-age=0/i.test(cleared!)).toBe(true);
  });

  it('rate-limits repeated login attempts with 429', async () => {
    const app = makeApp();
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await request(app).post('/api/admin/login').send({ password: 'nope' });
      last = res.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});
