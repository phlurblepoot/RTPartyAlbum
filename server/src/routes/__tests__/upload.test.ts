import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { openMemoryDb } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import { makeSettingsRepo } from '../../db/repositories/settingsRepo.js';
import { makeThemeRepo } from '../../db/repositories/themeRepo.js';
import { makeEventRepo } from '../../db/repositories/eventRepo.js';
import { makePhotoRepo } from '../../db/repositories/photoRepo.js';
import { DEFAULT_THEME_ID, DEFAULT_MOTION_CONFIG } from '@rtpa/shared';
import type { Photo } from '@rtpa/shared';
import { makeJpegBuffer, makeMp4Buffer, makeTmpDir, cleanupTmp } from '../../../tests/helpers/fixtures.js';

interface SeedOpts {
  code: string;
  uploadEnabled?: boolean;
  status?: 'active' | 'ended';
}

async function makeApp(opts: {
  dataDir: string;
  uploadsDir: string;
  uploadRateMax?: number;
}) {
  const config = loadConfig({
    nodeEnv: 'test',
    dataDir: opts.dataDir,
    uploadsDir: opts.uploadsDir,
    adminPassword: 'hunter2',
  });
  const db = openMemoryDb();
  migrate(db);
  const settingsRepo = makeSettingsRepo(db);
  const themeRepo = makeThemeRepo(db);
  const eventRepo = makeEventRepo(db);
  const photoRepo = makePhotoRepo(db);
  seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });

  const emitted: Array<{ code: string; photo: Photo }> = [];
  const realtime = {
    emitPhotoAdded: vi.fn((code: string, photo: Photo) => {
      emitted.push({ code, photo });
    }),
    emitPhotoHidden: vi.fn(),
    emitPhotoDeleted: vi.fn(),
    emitSettingsUpdated: vi.fn(),
    emitThemeUpdated: vi.fn(),
  };

  const app = buildApp({ db, config, realtime, uploadRateMax: opts.uploadRateMax });

  function seedEvent(o: SeedOpts) {
    const ev = eventRepo.create({
      name: `Event ${o.code}`,
      code: o.code,
      themeId: DEFAULT_THEME_ID,
      motionConfig: DEFAULT_MOTION_CONFIG,
    });
    eventRepo.activate(ev.id);
    if (o.uploadEnabled === false) eventRepo.setUploadEnabled(ev.id, false);
    if (o.status === 'ended') eventRepo.end(ev.id);
    return eventRepo.getByCode(o.code)!;
  }

  return { app, eventRepo, photoRepo, realtime, emitted, seedEvent };
}

describe('POST /api/events/by-code/:code/upload', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await cleanupTmp(dirs);
  });

  async function dirsForTest() {
    const dataDir = await makeTmpDir();
    const uploadsDir = await makeTmpDir();
    dirs.push(dataDir, uploadsDir);
    return { dataDir, uploadsDir };
  }

  it('uploads two images: writes files, persists rows, broadcasts public Photo, returns Photo[]', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, photoRepo, realtime, emitted, seedEvent } = await makeApp({ dataDir, uploadsDir });
    const ev = seedEvent({ code: 'party1', uploadEnabled: true });

    const jpeg = await makeJpegBuffer(800, 600);
    const res = await request(app)
      .post('/api/events/by-code/party1/upload')
      .field('uploaderName', 'Bob')
      .field('deviceId', 'dev-1')
      .attach('files', jpeg, 'one.jpg')
      .attach('files', jpeg, 'two.jpg');

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    const photo = res.body[0];
    expect(photo.uploaderName).toBe('Bob');
    expect(photo.mediaType).toBe('image');
    expect(photo.displayUrl).toMatch(/^\/media\/display\/.+\.jpg$/);
    expect(photo.thumbUrl).toMatch(/^\/media\/thumb\/.+\.jpg$/);
    // public Photo must NOT expose device fields
    expect(photo.deviceId).toBeUndefined();
    expect(photo.userAgent).toBeUndefined();
    expect(photo.ipAddress).toBeUndefined();

    // original written under uploads/<eventId>/
    const eventDir = path.join(uploadsDir, ev.id);
    const entries = await fs.readdir(eventDir);
    expect(entries).toHaveLength(2);
    // derived files exist (filenames come from the URLs, which are the basenames of
    // the stored *_path values — the media photoId is independent of the DB row id).
    const displayFile = path.basename(photo.displayUrl);
    const thumbFile = path.basename(photo.thumbUrl);
    await expect(
      fs.stat(path.join(dataDir, 'media', 'display', displayFile)),
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(dataDir, 'media', 'thumb', thumbFile)),
    ).resolves.toBeDefined();

    // photoRepo row persists device info privately
    const admin = photoRepo.getById(photo.id)!;
    expect(admin.deviceId).toBe('dev-1');
    expect(admin.ipAddress).toBeTruthy();

    // emitPhotoAdded broadcasts the PUBLIC photo (no device fields)
    expect(realtime.emitPhotoAdded).toHaveBeenCalledTimes(2);
    expect(emitted[0].code).toBe('party1');
    expect((emitted[0].photo as Record<string, unknown>).deviceId).toBeUndefined();
  });

  it('uploads a video: persists durationMs and mp4 display', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, photoRepo, seedEvent } = await makeApp({ dataDir, uploadsDir });
    seedEvent({ code: 'vid1', uploadEnabled: true });

    const { buffer, tmpDir } = await makeMp4Buffer(1);
    dirs.push(tmpDir);
    const res = await request(app)
      .post('/api/events/by-code/vid1/upload')
      .field('uploaderName', 'Vee')
      .field('deviceId', 'dev-v')
      .attach('files', buffer, 'clip.mp4');

    expect(res.status).toBe(201);
    const photo = res.body[0];
    expect(photo.mediaType).toBe('video');
    expect(photo.displayUrl).toMatch(/^\/media\/display\/.+\.mp4$/);
    expect(photo.durationMs).toBeGreaterThan(0);
    await expect(
      fs.stat(path.join(dataDir, 'media', 'display', path.basename(photo.displayUrl))),
    ).resolves.toBeDefined();
    const admin = photoRepo.getById(photo.id)!;
    expect(admin.deviceId).toBe('dev-v');
  });

  it('rolls back the whole batch (DB rows + files) when a later file fails to process', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, eventRepo, photoRepo, realtime, seedEvent } = await makeApp({ dataDir, uploadsDir });
    const ev = seedEvent({ code: 'atomic1', uploadEnabled: true });

    const goodJpeg = await makeJpegBuffer(400, 300);
    // Valid JPEG magic bytes (FF D8 FF E0) but a corrupt/garbage body: passes
    // validateUpload (magic detect = image) yet makes sharp/processImage throw —
    // a genuine MID-BATCH processing failure, not a validation rejection.
    const corruptJpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(128, 0x41),
    ]);

    const res = await request(app)
      .post('/api/events/by-code/atomic1/upload')
      .field('uploaderName', 'Atom')
      .field('deviceId', 'dev-a')
      .attach('files', goodJpeg, 'good.jpg')
      .attach('files', corruptJpeg, 'bad.jpg');

    // Masked 5xx body (NOT a 400 validation rejection): proves the failure came from
    // processing the second file, after the first was already persisted.
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });

    // No emit for any photo when the batch fails.
    expect(realtime.emitPhotoAdded).not.toHaveBeenCalled();

    // Zero rows survive (the first file's row was rolled back).
    expect(photoRepo.listForEventAdmin(ev.id)).toHaveLength(0);
    expect(photoRepo.countForEvent(ev.id)).toBe(0);
    const photos = await request(app).get('/api/events/by-code/atomic1/photos');
    expect(photos.body).toEqual([]);

    // No leftover originals under uploads/<eventId>.
    const eventDir = path.join(uploadsDir, ev.id);
    const originals = await fs.readdir(eventDir).catch(() => [] as string[]);
    expect(originals).toHaveLength(0);

    // No leftover derived files under dataDir/media (display + thumb).
    const displayFiles = await fs.readdir(path.join(dataDir, 'media', 'display')).catch(() => [] as string[]);
    const thumbFiles = await fs.readdir(path.join(dataDir, 'media', 'thumb')).catch(() => [] as string[]);
    expect(displayFiles).toHaveLength(0);
    expect(thumbFiles).toHaveLength(0);

    void eventRepo;
  });

  it('returns 403 when uploads are disabled', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, seedEvent } = await makeApp({ dataDir, uploadsDir });
    seedEvent({ code: 'closed1', uploadEnabled: false });
    const jpeg = await makeJpegBuffer(100, 100);
    const res = await request(app)
      .post('/api/events/by-code/closed1/upload')
      .field('uploaderName', 'X')
      .field('deviceId', 'd')
      .attach('files', jpeg, 'a.jpg');
    expect(res.status).toBe(403);
  });

  it('returns 403 when the event has ended', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, seedEvent } = await makeApp({ dataDir, uploadsDir });
    seedEvent({ code: 'ended1', status: 'ended' });
    const jpeg = await makeJpegBuffer(100, 100);
    const res = await request(app)
      .post('/api/events/by-code/ended1/upload')
      .field('uploaderName', 'X')
      .field('deviceId', 'd')
      .attach('files', jpeg, 'a.jpg');
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown event code', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app } = await makeApp({ dataDir, uploadsDir });
    const jpeg = await makeJpegBuffer(100, 100);
    const res = await request(app)
      .post('/api/events/by-code/nope/upload')
      .field('uploaderName', 'X')
      .field('deviceId', 'd')
      .attach('files', jpeg, 'a.jpg');
    expect(res.status).toBe(404);
  });

  it('returns 400 when uploaderName is missing', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, seedEvent } = await makeApp({ dataDir, uploadsDir });
    seedEvent({ code: 'noname', uploadEnabled: true });
    const jpeg = await makeJpegBuffer(100, 100);
    const res = await request(app)
      .post('/api/events/by-code/noname/upload')
      .field('deviceId', 'd')
      .attach('files', jpeg, 'a.jpg');
    expect(res.status).toBe(400);
  });

  it('returns 400 when deviceId is missing', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, seedEvent } = await makeApp({ dataDir, uploadsDir });
    seedEvent({ code: 'nodev', uploadEnabled: true });
    const jpeg = await makeJpegBuffer(100, 100);
    const res = await request(app)
      .post('/api/events/by-code/nodev/upload')
      .field('uploaderName', 'X')
      .attach('files', jpeg, 'a.jpg');
    expect(res.status).toBe(400);
  });

  it('returns 400 for a wrong-type file (text masquerading as image)', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, seedEvent } = await makeApp({ dataDir, uploadsDir });
    seedEvent({ code: 'badtype', uploadEnabled: true });
    // declared image/jpeg but bytes are plain text → validateUpload rejects (400).
    const res = await request(app)
      .post('/api/events/by-code/badtype/upload')
      .field('uploaderName', 'X')
      .field('deviceId', 'd')
      .attach('files', Buffer.from('this is not an image at all, just text bytes'), {
        filename: 'fake.jpg',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unsupported mimetype family (fileFilter → HttpError 400)', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, seedEvent } = await makeApp({ dataDir, uploadsDir });
    seedEvent({ code: 'pdf1', uploadEnabled: true });
    const res = await request(app)
      .post('/api/events/by-code/pdf1/upload')
      .field('uploaderName', 'X')
      .field('deviceId', 'd')
      .attach('files', Buffer.from('%PDF-1.4 fake'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(400);
  });

  it('returns 413 for an oversize file (multer LIMIT_FILE_SIZE)', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, seedEvent } = await makeApp({ dataDir, uploadsDir });
    seedEvent({ code: 'big1', uploadEnabled: true });
    // Force a tiny cap via the app's own settings repo so a normal jpeg exceeds it.
    // The multer byte cap is computed lazily on the first request from these limits.
    const settingsRepo = (app as unknown as { get: (k: string) => unknown }).get(
      'settingsRepo',
    ) as { setJson: (k: string, v: unknown) => void };
    settingsRepo.setJson('media_limits', {
      photoMaxBytes: 1024,
      videoMaxBytes: 1024,
      videoMaxDurationSec: 30,
    });
    const jpeg = await makeJpegBuffer(1200, 1200); // well over 1KB
    const res = await request(app)
      .post('/api/events/by-code/big1/upload')
      .field('uploaderName', 'X')
      .field('deviceId', 'd')
      .attach('files', jpeg, 'huge.jpg');
    expect(res.status).toBe(413);
  });

  it('rate-limits a flood of uploads from the same device (429)', async () => {
    const { dataDir, uploadsDir } = await dirsForTest();
    const { app, seedEvent } = await makeApp({ dataDir, uploadsDir, uploadRateMax: 2 });
    seedEvent({ code: 'rl1', uploadEnabled: true });
    const jpeg = await makeJpegBuffer(100, 100);
    const send = () =>
      request(app)
        .post('/api/events/by-code/rl1/upload')
        .field('uploaderName', 'Flood')
        .field('deviceId', 'dev-flood')
        .attach('files', jpeg, 'a.jpg');
    const r1 = await send();
    const r2 = await send();
    const r3 = await send();
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r3.status).toBe(429);
  });
});
