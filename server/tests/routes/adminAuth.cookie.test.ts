import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { rmSync } from 'node:fs';
import { createTestApp, TEST_ADMIN_PASSWORD, type TestApp } from '../helpers/testApp.js';

/**
 * Regression tests for the session cookie's `Secure` attribute.
 *
 * The bug: `secure` was hardcoded to `NODE_ENV === 'production'`, so a
 * production deployment served over plain HTTP (the docker-compose default,
 * port 8080, no TLS) emitted a `Secure` cookie. Browsers silently DROP a
 * Secure cookie received over HTTP, so login "succeeded" but every subsequent
 * authenticated request 401'd. The fix ties `secure` to the real request
 * protocol (`req.secure`, which honors X-Forwarded-Proto under `trust proxy`).
 */
describe('admin login session cookie Secure flag', () => {
  let ctx: TestApp;
  const dataDir = '/tmp/rtpa-cookie-test-data';
  const uploadsDir = '/tmp/rtpa-cookie-test-uploads';

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  async function login(forwardedProto?: string) {
    ctx = await createTestApp({ dataDir, uploadsDir });
    let req = request(ctx.app).post('/api/admin/login');
    if (forwardedProto) req = req.set('X-Forwarded-Proto', forwardedProto);
    const res = await req.send({ password: TEST_ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie).toBeDefined();
    return setCookie.find((c) => c.startsWith('rtpa_session='))!;
  }

  it('omits Secure when the request arrives over plain HTTP', async () => {
    const cookie = await login();
    expect(cookie).not.toMatch(/;\s*Secure/i);
    // HttpOnly should still be present regardless of protocol.
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('sets Secure when behind a TLS-terminating proxy (X-Forwarded-Proto: https)', async () => {
    const cookie = await login('https');
    expect(cookie).toMatch(/;\s*Secure/i);
  });
});
