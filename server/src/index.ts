import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { makeSettingsRepo } from './db/repositories/settingsRepo.js';
import { makeThemeRepo } from './db/repositories/themeRepo.js';
import { buildApp } from './app.js';
import { initRealtime } from './realtime/realtime.js';

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

  // Create the bare HTTP server first so Socket.IO can attach its upgrade
  // handler to it, then build the app with the REAL realtime emitters and route
  // plain HTTP requests to Express. This shares one port for HTTP + WebSocket.
  const httpServer = createServer();
  const realtime = initRealtime(httpServer);
  const app = buildApp({ db, config, realtime });
  httpServer.on('request', app);

  httpServer.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[rtpa] server listening on :${config.port} (env=${config.nodeEnv})`);
  });
}

main();
