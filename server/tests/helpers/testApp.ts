import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openMemoryDb } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seed.js';
import { makeSettingsRepo } from '../../src/db/repositories/settingsRepo.js';
import { makeThemeRepo } from '../../src/db/repositories/themeRepo.js';
import { makeEventRepo } from '../../src/db/repositories/eventRepo.js';
import { DEFAULT_THEME_ID, DEFAULT_MOTION_CONFIG } from '@rtpa/shared';

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

/**
 * Create a test Express app backed by an in-memory DB, fully wired with repos and
 * admin bootstrap. Returns the app plus a `seedActiveEvent` helper.
 */
export async function createTestApp(opts: CreateTestAppOpts) {
  const adminPassword = opts.adminPassword ?? 'test-admin-pw';
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
  seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });

  const app = buildApp({ db, config, uploadRateMax: opts.uploadRateMax });

  function seedActiveEvent(o: SeedEventOpts) {
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

  return { app, eventRepo, seedActiveEvent };
}
