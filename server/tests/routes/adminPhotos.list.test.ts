import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import { loginAdmin } from '../helpers/auth.js';
import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

describe('GET /api/admin/events/:id/photos', () => {
  const dirs: string[] = [];
  afterAll(async () => { await cleanupTmp(dirs); });

  it('returns PhotoAdmin[] newest-first with device fields', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
    const ev = seedActiveEvent({ code: 'adm1', uploadEnabled: true });

    const jpeg = await makeJpegBuffer(200, 200);
    await request(app)
      .post('/api/events/by-code/adm1/upload')
      .field('uploaderName', 'First').field('deviceId', 'd-first')
      .attach('files', jpeg, '1.jpg');
    await request(app)
      .post('/api/events/by-code/adm1/upload')
      .field('uploaderName', 'Second').field('deviceId', 'd-second')
      .attach('files', jpeg, '2.jpg');

    const agent = await loginAdmin(app);
    const res = await agent.get(`/api/admin/events/${ev.id}/photos`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // newest-first: 'Second' uploaded last
    expect(res.body[0].uploaderName).toBe('Second');
    // admin view DOES include device fields
    expect(res.body[0].deviceId).toBe('d-second');
    expect(res.body[0]).toHaveProperty('userAgent');
    expect(res.body[0]).toHaveProperty('ipAddress');
  });

  it('requires admin auth (401 without cookie)', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
    const ev = seedActiveEvent({ code: 'adm2', uploadEnabled: true });
    const res = await request(app).get(`/api/admin/events/${ev.id}/photos`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for a missing event', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app } = await createTestApp({ dataDir, uploadsDir });
    const agent = await loginAdmin(app);
    const res = await agent.get('/api/admin/events/nonexistent-id/photos');
    expect(res.status).toBe(404);
  });
});
