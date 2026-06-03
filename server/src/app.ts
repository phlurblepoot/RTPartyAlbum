import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { Db } from './db/connection.js';
import type { Config } from './config.js';
import { healthRouter } from './routes/health.js';
import { mediaRouter } from './routes/media.js';
import { makeAdminAuthRouter } from './routes/adminAuth.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { makeSettingsRepo } from './db/repositories/settingsRepo.js';
import { ensureAdminBootstrap } from './auth/auth.js';

export interface AppDeps {
  db: Db;
  config: Config;
}

/**
 * Builds the Express app with no `listen` so it is testable with supertest.
 * `db` and `config` are stashed on the app via `app.set(...)` so later plans'
 * routers can reach them (and add `realtime`/repos) without changing this signature.
 */
export function buildApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  // Build repos and bootstrap admin password before mounting routes.
  const settingsRepo = makeSettingsRepo(deps.db);
  ensureAdminBootstrap(settingsRepo, deps.config);
  app.set('db', deps.db);
  app.set('config', deps.config);
  app.set('settingsRepo', settingsRepo);

  // Middleware: cookie-parser and JSON body before routes.
  app.use(cookieParser());
  app.use(express.json());

  app.use('/api/health', healthRouter());
  app.use('/api/admin', makeAdminAuthRouter());
  app.use('/media', mediaRouter(deps.config.dataDir));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
