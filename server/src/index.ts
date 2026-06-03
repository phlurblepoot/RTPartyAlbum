import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { makeSettingsRepo } from './db/repositories/settingsRepo.js';
import { makeThemeRepo } from './db/repositories/themeRepo.js';
import { buildApp } from './app.js';

function ensureDirs(dataDir: string, uploadsDir: string): void {
  mkdirSync(join(dataDir, 'media', 'display'), { recursive: true });
  mkdirSync(join(dataDir, 'media', 'thumb'), { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });
}

function main(): void {
  const config = loadConfig();
  ensureDirs(config.dataDir, config.uploadsDir);

  const db = openDb(join(config.dataDir, 'rtpa.db'));
  migrate(db);

  const settingsRepo = makeSettingsRepo(db);
  const themeRepo = makeThemeRepo(db);
  seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });

  const app = buildApp({ db, config });
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[rtpa] server listening on :${config.port} (env=${config.nodeEnv})`);
  });
}

main();
