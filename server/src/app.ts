import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { Db } from './db/connection.js';
import type { Config } from './config.js';
import { healthRouter } from './routes/health.js';
import { mediaRouter } from './routes/media.js';
import { makeAdminAuthRouter } from './routes/adminAuth.js';
import { makeAdminEventsRouter } from './routes/adminEvents.js';
import { makeAdminThemesRouter } from './routes/adminThemes.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { makeSettingsRepo } from './db/repositories/settingsRepo.js';
import { makeEventRepo } from './db/repositories/eventRepo.js';
import { makeThemeRepo } from './db/repositories/themeRepo.js';
import { ensureAdminBootstrap, requireAuth } from './auth/auth.js';
import type { RealtimeEmitters } from './realtime/realtime.js';

export type { RealtimeEmitters };

export const noopRealtime: RealtimeEmitters = {
  emitPhotoAdded() {},
  emitPhotoHidden() {},
  emitPhotoDeleted() {},
  emitSettingsUpdated() {},
  emitThemeUpdated() {},
};

export interface AppDeps {
  db: Db;
  config: Config;
  realtime?: RealtimeEmitters;
}

/**
 * Builds the Express app with no `listen` so it is testable with supertest.
 * `db` and `config` are stashed on the app via `app.set(...)` so later plans'
 * routers can reach them (and add `realtime`/repos) without changing this signature.
 */
export function buildApp(deps: AppDeps): Express {
  const { db, config, realtime = noopRealtime } = deps;
  const app = express();
  app.disable('x-powered-by');

  // Build repos and bootstrap admin password before mounting routes.
  const settingsRepo = makeSettingsRepo(db);
  ensureAdminBootstrap(settingsRepo, config);
  const eventRepo = makeEventRepo(db);
  const themeRepo = makeThemeRepo(db);
  app.set('db', db);
  app.set('config', config);
  app.set('realtime', realtime);
  app.set('settingsRepo', settingsRepo);
  app.set('eventRepo', eventRepo);
  app.set('themeRepo', themeRepo);

  // Middleware: cookie-parser and JSON body before routes.
  app.use(cookieParser());
  app.use(express.json());

  app.use('/api/health', healthRouter());
  app.use('/api/admin', makeAdminAuthRouter());
  app.use('/api/admin/events', requireAuth, makeAdminEventsRouter());
  app.use('/api/admin/themes', requireAuth, makeAdminThemesRouter());
  app.use('/media', mediaRouter(config.dataDir));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
