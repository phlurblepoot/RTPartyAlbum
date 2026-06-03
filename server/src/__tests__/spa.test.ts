import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { openMemoryDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { loadConfig } from '../config.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'rtpa-spa-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
const APP_JS = 'console.log("app");';

/** Build a minimal web build dir (index.html + assets/app.js) for SPA tests. */
function makeWebDir(): string {
  const web = tmp();
  writeFileSync(join(web, 'index.html'), INDEX_HTML);
  mkdirSync(join(web, 'assets'));
  writeFileSync(join(web, 'assets', 'app.js'), APP_JS);
  return web;
}

function deps(overrides: Record<string, unknown> = {}) {
  const db = openMemoryDb();
  migrate(db);
  return { db, config: loadConfig({ dataDir: tmp(), ...overrides }) };
}

describe('SPA serving (web build present)', () => {
  it('GET /e/:code returns 200 index.html (client route)', async () => {
    const app = buildApp(deps({ webDir: makeWebDir() }));
    const res = await request(app).get('/e/SOMECODE');
    expect(res.status).toBe(200);
    expect(res.text).toBe(INDEX_HTML);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('GET /e/:code/display returns 200 index.html', async () => {
    const app = buildApp(deps({ webDir: makeWebDir() }));
    const res = await request(app).get('/e/x/display');
    expect(res.status).toBe(200);
    expect(res.text).toBe(INDEX_HTML);
  });

  it('GET /admin/anything returns 200 index.html', async () => {
    const app = buildApp(deps({ webDir: makeWebDir() }));
    const res = await request(app).get('/admin/anything');
    expect(res.status).toBe(200);
    expect(res.text).toBe(INDEX_HTML);
  });

  it('GET /assets/app.js is served as a static file (not index.html)', async () => {
    const app = buildApp(deps({ webDir: makeWebDir() }));
    const res = await request(app).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe(APP_JS);
    expect(res.headers['content-type']).toMatch(/javascript/);
  });

  it('hashed assets get a long immutable max-age; index.html / client routes revalidate', async () => {
    const app = buildApp(deps({ webDir: makeWebDir() }));
    // Content-addressed asset -> cache long + immutable.
    const asset = await request(app).get('/assets/app.js');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    // Static index.html (if requested directly) -> no-cache.
    const indexDirect = await request(app).get('/index.html');
    expect(indexDirect.headers['cache-control']).toBe('no-cache');
    // SPA-fallback client route also serves index.html with no-cache.
    const clientRoute = await request(app).get('/e/SOMECODE');
    expect(clientRoute.headers['cache-control']).toBe('no-cache');
  });

  it('GET / returns the SPA index.html', async () => {
    const app = buildApp(deps({ webDir: makeWebDir() }));
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe(INDEX_HTML);
  });

  it('unknown /api route still returns JSON 404 (NOT index.html)', async () => {
    const app = buildApp(deps({ webDir: makeWebDir() }));
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.text).not.toBe(INDEX_HTML);
  });

  it('GET /api/health still returns {status:"ok"}', async () => {
    const app = buildApp(deps({ webDir: makeWebDir() }));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('POST to a non-/api SPA route is not swallowed by the fallback (404)', async () => {
    const app = buildApp(deps({ webDir: makeWebDir() }));
    const res = await request(app).post('/e/SOMECODE');
    expect(res.status).toBe(404);
    expect(res.text).not.toBe(INDEX_HTML);
  });
});

describe('SPA serving (web build absent — API-only)', () => {
  it('GET /e/:code returns 404 when no web build exists', async () => {
    const app = buildApp(deps({ webDir: join(tmp(), 'does-not-exist') }));
    const res = await request(app).get('/e/x');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/health still works with no web build', async () => {
    const app = buildApp(deps({ webDir: join(tmp(), 'does-not-exist') }));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
