import express, { type Express } from 'express';
import type { Db } from './db/connection.js';
import type { Config } from './config.js';
import { healthRouter } from './routes/health.js';
import { mediaRouter } from './routes/media.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

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
  app.use(express.json());

  app.set('db', deps.db);
  app.set('config', deps.config);

  app.use('/api/health', healthRouter());
  app.use('/media', mediaRouter(deps.config.dataDir));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
