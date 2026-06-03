import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { openMemoryDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { loadConfig } from '../config.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'rtpa-app-'));
  dirs.push(d);
  return d;
}
/** A minimal deps object for app-level tests (health/404 don't touch the db). */
function deps() {
  const db = openMemoryDb();
  migrate(db);
  return { db, config: loadConfig({ dataDir: tmp() }) };
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('buildApp', () => {
  it('GET /api/health returns {status:"ok"}', async () => {
    const app = buildApp(deps());
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it("sets 'trust proxy' to 1 so req.ip is the real client behind a reverse proxy", () => {
    const app = buildApp(deps());
    expect(app.get('trust proxy')).toBe(1);
  });

  it('unknown /api route returns JSON 404 via error handler', async () => {
    const app = buildApp(deps());
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});
