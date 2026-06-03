import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import AdmZip from 'adm-zip';
import { createTestApp } from '../helpers/testApp.js';
import { loginAdmin } from '../helpers/auth.js';
import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

/**
 * Full media-pipeline integration test (Plan 3, Task 10).
 *
 * Exercises the whole flow against the real wired app:
 *   upload 2 images -> admin list shows 2 newest-first (with device fields)
 *   -> hide 1 -> public photos shows 1 -> export zip has BOTH originals + manifest.
 * Also asserts the realtime spy emissions (photo:added x2, photo:hidden x1).
 */
describe('media pipeline end-to-end', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await cleanupTmp(dirs);
  });

  it('upload 2 -> admin list 2 -> hide 1 -> public 1 -> export 2', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app, emitted, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
    const ev = seedActiveEvent({ code: 'e2e1', uploadEnabled: true });
    const jpeg = await makeJpegBuffer(300, 200);

    const up1 = await request(app)
      .post('/api/events/by-code/e2e1/upload')
      .field('uploaderName', 'One')
      .field('deviceId', 'd1')
      .attach('files', jpeg, '1.jpg');
    const up2 = await request(app)
      .post('/api/events/by-code/e2e1/upload')
      .field('uploaderName', 'Two')
      .field('deviceId', 'd2')
      .attach('files', jpeg, '2.jpg');
    expect(up1.status).toBe(201);
    expect(up2.status).toBe(201);
    const photo1 = up1.body[0];
    const photo2 = up2.body[0];

    // The public upload responses must NOT leak device fields.
    expect(photo1).not.toHaveProperty('deviceId');
    expect(photo1).not.toHaveProperty('userAgent');
    expect(photo1).not.toHaveProperty('ipAddress');

    // Two photo:added emissions so far (one per upload).
    expect(emitted.filter((e) => e.type === 'photo:added')).toHaveLength(2);

    const agent = await loginAdmin(app);

    // admin list shows 2, newest-first, WITH private device fields.
    const list = await agent.get(`/api/admin/events/${ev.id}/photos`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0].uploaderName).toBe('Two');
    expect(list.body[1].uploaderName).toBe('One');
    expect(list.body[0].deviceId).toBe('d2');
    expect(list.body[1].deviceId).toBe('d1');
    expect(list.body[0]).toHaveProperty('userAgent');
    expect(list.body[0]).toHaveProperty('ipAddress');

    // hide photo1 (the "One" upload).
    const hide = await agent.post(`/api/admin/photos/${photo1.id}/hide`).send({ hidden: true });
    expect(hide.status).toBe(204);

    // one photo:hidden emission, carrying the hidden photo's id.
    const hiddenEvents = emitted.filter((e) => e.type === 'photo:hidden');
    expect(hiddenEvents).toHaveLength(1);
    expect((hiddenEvents[0].payload as { id: string }).id).toBe(photo1.id);

    // public photos now shows 1 (visible only) — the "Two" upload.
    const pub = await request(app).get('/api/events/by-code/e2e1/photos');
    expect(pub.status).toBe(200);
    expect(pub.body).toHaveLength(1);
    expect(pub.body[0].uploaderName).toBe('Two');
    expect(pub.body[0].id).toBe(photo2.id);
    // public payload still strips device fields.
    expect(pub.body[0]).not.toHaveProperty('deviceId');

    // export still includes BOTH originals (hidden files are kept) + manifest.
    const exp = await agent
      .get(`/api/admin/events/${ev.id}/export`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toMatch(/zip/);

    const zip = new AdmZip(exp.body as Buffer);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('manifest.json');
    const originals = names.filter((n) => n !== 'manifest.json');
    expect(originals).toHaveLength(2);

    // The manifest lists both photos regardless of hidden state.
    const manifest = JSON.parse(zip.readAsText('manifest.json')) as Array<{ uploaderName: string }>;
    expect(manifest).toHaveLength(2);
    const manifestNames = manifest.map((m) => m.uploaderName).sort();
    expect(manifestNames).toEqual(['One', 'Two']);
  });
});
