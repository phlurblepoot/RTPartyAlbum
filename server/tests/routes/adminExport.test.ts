import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import AdmZip from 'adm-zip';
import { createTestApp } from '../helpers/testApp.js';
import { loginAdmin } from '../helpers/auth.js';
import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

describe('GET /api/admin/events/:id/export', () => {
  const dirs: string[] = [];
  afterAll(async () => { await cleanupTmp(dirs); });

  it('streams a zip containing manifest.json + N originals', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
    const ev = await seedActiveEvent({ code: 'exp1', uploadEnabled: true });

    const jpeg = await makeJpegBuffer(200, 200);
    await request(app).post('/api/events/by-code/exp1/upload')
      .field('uploaderName', 'Amy').field('deviceId', 'd1').attach('files', jpeg, 'a.jpg');
    await request(app).post('/api/events/by-code/exp1/upload')
      .field('uploaderName', 'Ben').field('deviceId', 'd2').attach('files', jpeg, 'b.jpg');

    const agent = await loginAdmin(app);
    const res = await agent
      .get(`/api/admin/events/${ev.id}/export`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/zip/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);

    const zip = new AdmZip(res.body as Buffer);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('manifest.json');
    // 2 originals + manifest
    const originals = names.filter((n) => n !== 'manifest.json');
    expect(originals).toHaveLength(2);
    expect(originals.some((n) => n.includes('Amy'))).toBe(true);
    expect(originals.some((n) => n.includes('Ben'))).toBe(true);

    // Zip-slip safety: entry names must never contain path separators or traversal.
    originals.forEach((n) => {
      expect(n).not.toContain('/');
      expect(n).not.toContain('\\');
      expect(n).not.toContain('..');
    });

    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    expect(Array.isArray(manifest)).toBe(true);
    expect(manifest).toHaveLength(2);
    expect(manifest[0]).toHaveProperty('photoId');
    expect(manifest[0]).toHaveProperty('uploaderName');
    expect(manifest[0]).toHaveProperty('createdAt');
    expect(manifest[0]).toHaveProperty('mediaType');
    expect(manifest[0]).toHaveProperty('filename');
  });

  it('sanitizes a malicious uploaderName so zip entries cannot path-traverse', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
    const ev = await seedActiveEvent({ code: 'exp3', uploadEnabled: true });

    const evil = '../../etc/passwd';
    const jpeg = await makeJpegBuffer(200, 200);
    await request(app).post('/api/events/by-code/exp3/upload')
      .field('uploaderName', evil).field('deviceId', 'd1').attach('files', jpeg, 'x.jpg');

    const agent = await loginAdmin(app);
    const res = await agent
      .get(`/api/admin/events/${ev.id}/export`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);

    const zip = new AdmZip(res.body as Buffer);
    const names = zip.getEntries().map((e) => e.entryName);
    const originals = names.filter((n) => n !== 'manifest.json');
    expect(originals).toHaveLength(1);

    // The single original entry must be free of traversal chars (safeName stripped them).
    const entry = originals[0];
    expect(entry).not.toContain('/');
    expect(entry).not.toContain('\\');
    expect(entry).not.toContain('..');
    // safeName('../../etc/passwd') strips separators/dots -> 'etcpasswd'.
    expect(entry).toContain('etcpasswd');

    // Manifest is data, not a path: it preserves the raw uploaderName string as-is.
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    expect(manifest).toHaveLength(1);
    expect(manifest[0].uploaderName).toBe(evil);
  });

  it('requires admin auth', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
    const ev = await seedActiveEvent({ code: 'exp2', uploadEnabled: true });
    const res = await request(app).get(`/api/admin/events/${ev.id}/export`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for a missing event', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app } = await createTestApp({ dataDir, uploadsDir });
    const agent = await loginAdmin(app);
    const res = await agent.get('/api/admin/events/nonexistent-id/export');
    expect(res.status).toBe(404);
  });
});
