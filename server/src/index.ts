import { createServer, type Server } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb, type Db } from './db/connection.js';
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

  installShutdownHandlers(httpServer, db);
}

/**
 * Graceful shutdown + process-level error handling.
 *
 * On SIGTERM/SIGINT we stop accepting NEW connections and let `httpServer.close`
 * wait for in-flight requests to drain — this matters because a request may be a
 * large upload or an in-progress ffmpeg encode/zip stream, and tearing those down
 * mid-flight would corrupt media. Only once the HTTP server has drained do we close
 * the SQLite handle (which flushes the WAL) and exit cleanly.
 *
 * A forced-exit timer guards against a connection that never drains (e.g. a stuck
 * keep-alive socket). The timer is `.unref()`'d so it never by itself keeps the
 * process alive once the clean path has completed.
 */
function installShutdownHandlers(httpServer: Server, db: Db): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[rtpa] received ${signal}, shutting down gracefully...`);

    const forced = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error('[rtpa] graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forced.unref();

    httpServer.close((err) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error('[rtpa] error closing http server:', err);
      }
      try {
        db.close(); // flush SQLite WAL to disk
      } catch (closeErr) {
        // eslint-disable-next-line no-console
        console.error('[rtpa] error closing database:', closeErr);
      }
      // eslint-disable-next-line no-console
      console.log('[rtpa] shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('[rtpa] unhandledRejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[rtpa] uncaughtException:', err);
    process.exit(1);
  });
}

main();
