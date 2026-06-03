import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import { createTestApp } from '../helpers/testApp.js';
import { loginAdmin } from '../helpers/auth.js';
import { makeJpegBuffer, makeTmpDir, cleanupTmp } from '../helpers/fixtures.js';

async function uploadOne(app: any, code: string) {
  const jpeg = await makeJpegBuffer(200, 200);
  const res = await request(app)
    .post(`/api/events/by-code/${code}/upload`)
    .field('uploaderName', 'U')
    .field('deviceId', 'd')
    .attach('files', jpeg, 'x.jpg');
  return res.body[0];
}

describe('admin hide/delete', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await cleanupTmp(dirs);
  });

  it('hide then unhide emits the right events and toggles visibility', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app, emitted, repos, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
    await seedActiveEvent({ code: 'hd1', uploadEnabled: true });
    const photo = await uploadOne(app, 'hd1');
    const agent = await loginAdmin(app);

    // --- hide ---
    const hideRes = await agent.post(`/api/admin/photos/${photo.id}/hide`).send({ hidden: true });
    expect(hideRes.status).toBe(204);
    expect(repos.photoRepo.getById(photo.id)!.isHidden).toBe(true);
    expect(emitted.some((e) => e.type === 'photo:hidden' && (e.payload as any).id === photo.id)).toBe(true);

    // hidden photo should not appear in public listing
    const event = repos.eventRepo.getByCode('hd1')!;
    const publicPhotos = repos.photoRepo.listForEventPublic(event.id);
    expect(publicPhotos.some((p) => p.id === photo.id)).toBe(false);

    // --- unhide ---
    const unhideRes = await agent.post(`/api/admin/photos/${photo.id}/hide`).send({ hidden: false });
    expect(unhideRes.status).toBe(204);
    expect(repos.photoRepo.getById(photo.id)!.isHidden).toBe(false);

    // unhide re-broadcasts photo:added with a visible Photo (no device fields)
    const addedEvents = emitted.filter((e) => e.type === 'photo:added');
    const lastAdded = addedEvents[addedEvents.length - 1];
    expect(lastAdded).toBeDefined();
    expect((lastAdded.payload as any).id).toBe(photo.id);
    // must NOT have device fields
    expect((lastAdded.payload as any).deviceId).toBeUndefined();
    expect((lastAdded.payload as any).userAgent).toBeUndefined();
    expect((lastAdded.payload as any).ipAddress).toBeUndefined();

    // visible again in public listing
    const publicPhotosAfter = repos.photoRepo.listForEventPublic(event.id);
    expect(publicPhotosAfter.some((p) => p.id === photo.id)).toBe(true);
  });

  it('delete removes files and row and emits photo:deleted', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app, emitted, repos, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
    await seedActiveEvent({ code: 'dl1', uploadEnabled: true });
    const photo = await uploadOne(app, 'dl1');
    const paths = repos.photoRepo.getPaths(photo.id)!;

    // files exist before delete
    await expect(fs.stat(paths.filePath)).resolves.toBeDefined();
    await expect(fs.stat(paths.displayPath)).resolves.toBeDefined();
    await expect(fs.stat(paths.thumbPath)).resolves.toBeDefined();

    const agent = await loginAdmin(app);
    const delRes = await agent.delete(`/api/admin/photos/${photo.id}`);
    expect(delRes.status).toBe(204);

    // files removed
    await expect(fs.stat(paths.filePath)).rejects.toBeDefined();
    await expect(fs.stat(paths.displayPath)).rejects.toBeDefined();
    await expect(fs.stat(paths.thumbPath)).rejects.toBeDefined();

    // row gone
    expect(repos.photoRepo.getById(photo.id)).toBeUndefined();

    // broadcast emitted
    expect(
      emitted.some((e) => e.type === 'photo:deleted' && (e.payload as any).id === photo.id),
    ).toBe(true);
  });

  it('hide returns 401 without auth cookie', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
    await seedActiveEvent({ code: 'hd2', uploadEnabled: true });
    const photo = await uploadOne(app, 'hd2');
    const res = await request(app).post(`/api/admin/photos/${photo.id}/hide`).send({ hidden: true });
    expect(res.status).toBe(401);
  });

  it('delete returns 401 without auth cookie', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app, seedActiveEvent } = await createTestApp({ dataDir, uploadsDir });
    await seedActiveEvent({ code: 'dl2', uploadEnabled: true });
    const photo = await uploadOne(app, 'dl2');
    const res = await request(app).delete(`/api/admin/photos/${photo.id}`);
    expect(res.status).toBe(401);
  });

  it('hide returns 404 for a missing photo id', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app } = await createTestApp({ dataDir, uploadsDir });
    const agent = await loginAdmin(app);
    const res = await agent.post('/api/admin/photos/nonexistent-photo-id/hide').send({ hidden: true });
    expect(res.status).toBe(404);
  });

  it('delete returns 404 for a missing photo id', async () => {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    const { app } = await createTestApp({ dataDir, uploadsDir });
    const agent = await loginAdmin(app);
    const res = await agent.delete('/api/admin/photos/nonexistent-photo-id');
    expect(res.status).toBe(404);
  });
});
