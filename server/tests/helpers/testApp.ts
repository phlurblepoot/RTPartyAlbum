import type { Express } from 'express';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openMemoryDb, type Db } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seed.js';
import { makeSettingsRepo, type SettingsRepo } from '../../src/db/repositories/settingsRepo.js';
import { makeThemeRepo, type ThemeRepo } from '../../src/db/repositories/themeRepo.js';
import { makeEventRepo, type EventRepo } from '../../src/db/repositories/eventRepo.js';
import { makePhotoRepo, type PhotoRepo } from '../../src/db/repositories/photoRepo.js';
import type { RealtimeEmitters } from '../../src/realtime/realtime.js';
import { DEFAULT_THEME_ID, DEFAULT_MOTION_CONFIG, type EventDetail, type Photo } from '@rtpa/shared';

/** Shared admin password used by createTestApp's bootstrap and loginAdmin's default. */
export const TEST_ADMIN_PASSWORD = 'test-admin-pw';

interface SeedEventOpts {
  code: string;
  uploadEnabled?: boolean;
  status?: 'active' | 'ended';
}

interface CreateTestAppOpts {
  dataDir: string;
  uploadsDir: string;
  uploadRateMax?: number;
  adminPassword?: string;
}

/** A single captured realtime emission (type + payload). */
export interface EmittedEvent {
  type: string;
  payload: unknown;
}

/** Repos bundle returned by createTestApp. */
export interface TestRepos {
  eventRepo: EventRepo;
  photoRepo: PhotoRepo;
  themeRepo: ThemeRepo;
  settingsRepo: SettingsRepo;
}

export interface TestApp {
  app: Express;
  db: Db;
  /** Flat array of all realtime emissions captured during this test app's lifetime. */
  emitted: EmittedEvent[];
  /** Bundle of all repos (shorthand access). */
  repos: TestRepos;
  /** Individual repo references (kept for backward-compat with existing tests). */
  eventRepo: EventRepo;
  photoRepo: PhotoRepo;
  themeRepo: ThemeRepo;
  settingsRepo: SettingsRepo;
  seedActiveEvent: (o: SeedEventOpts) => EventDetail;
}

/**
 * Build a spy RealtimeEmitters that records all emissions into the given array.
 */
function makeSpyRealtime(emitted: EmittedEvent[]): RealtimeEmitters {
  return {
    emitPhotoAdded(code: string, photo: Photo) {
      emitted.push({ type: 'photo:added', payload: photo });
    },
    emitPhotoHidden(code: string, id: string) {
      emitted.push({ type: 'photo:hidden', payload: { id } });
    },
    emitPhotoDeleted(code: string, id: string) {
      emitted.push({ type: 'photo:deleted', payload: { id } });
    },
    emitSettingsUpdated(code: string, motionConfig) {
      emitted.push({ type: 'settings:updated', payload: motionConfig });
    },
    emitThemeUpdated(code: string, theme) {
      emitted.push({ type: 'theme:updated', payload: theme });
    },
  };
}

/**
 * Create a test Express app backed by an in-memory DB, fully wired with repos and
 * admin bootstrap. Returns the app, the underlying db + repos (for asserting
 * DB side-effects directly), an `emitted` array for realtime spy assertions,
 * and a `seedActiveEvent` helper.
 */
export async function createTestApp(opts: CreateTestAppOpts): Promise<TestApp> {
  const adminPassword = opts.adminPassword ?? TEST_ADMIN_PASSWORD;
  const config = loadConfig({
    nodeEnv: 'test',
    dataDir: opts.dataDir,
    uploadsDir: opts.uploadsDir,
    adminPassword,
  });
  const db = openMemoryDb();
  migrate(db);
  const settingsRepo = makeSettingsRepo(db);
  const themeRepo = makeThemeRepo(db);
  const eventRepo = makeEventRepo(db);
  const photoRepo = makePhotoRepo(db);
  seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });

  const emitted: EmittedEvent[] = [];
  const realtime = makeSpyRealtime(emitted);

  const app = buildApp({ db, config, realtime, uploadRateMax: opts.uploadRateMax });

  const repos: TestRepos = { eventRepo, photoRepo, themeRepo, settingsRepo };

  function seedActiveEvent(o: SeedEventOpts): EventDetail {
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

  return {
    app,
    db,
    emitted,
    repos,
    eventRepo,
    photoRepo,
    themeRepo,
    settingsRepo,
    seedActiveEvent,
  };
}
