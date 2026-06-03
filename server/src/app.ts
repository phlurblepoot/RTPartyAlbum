import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './db/connection.js';
import type { Config } from './config.js';
import { healthRouter } from './routes/health.js';
import { mediaRouter } from './routes/media.js';
import { makeAdminAuthRouter } from './routes/adminAuth.js';
import { makeAdminEventsRouter } from './routes/adminEvents.js';
import { makeAdminThemesRouter } from './routes/adminThemes.js';
import { makeAdminSettingsRouter } from './routes/adminSettings.js';
import { makeAdminPhotosRouter } from './routes/adminPhotos.js';
import { makeAdminExportRouter } from './routes/adminExport.js';
import { makePublicEventsRouter } from './routes/publicEvents.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { makeSettingsRepo } from './db/repositories/settingsRepo.js';
import { makeEventRepo } from './db/repositories/eventRepo.js';
import { makeThemeRepo } from './db/repositories/themeRepo.js';
import { makePhotoRepo } from './db/repositories/photoRepo.js';
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
  /** Optional override for the public upload rate-limit window max (tests use a tiny value). */
  uploadRateMax?: number;
}

/**
 * Builds the Express app with no `listen` so it is testable with supertest.
 * `db` and `config` are stashed on the app via `app.set(...)` so later plans'
 * routers can reach them (and add `realtime`/repos) without changing this signature.
 */
export function buildApp(deps: AppDeps): Express {
  const { db, config, realtime = noopRealtime, uploadRateMax } = deps;
  const app = express();
  app.disable('x-powered-by');
  // Trust the first proxy hop (reverse proxy on Unraid/Docker) so `req.ip`
  // reflects the real client address rather than the proxy's. This keeps the
  // login rate-limiter per-client and records true client IPs in photo audit data.
  app.set('trust proxy', 1);

  // Build repos and bootstrap admin password before mounting routes.
  const settingsRepo = makeSettingsRepo(db);
  ensureAdminBootstrap(settingsRepo, config);
  const eventRepo = makeEventRepo(db);
  const themeRepo = makeThemeRepo(db);
  const photoRepo = makePhotoRepo(db);
  app.set('db', db);
  app.set('config', config);
  app.set('realtime', realtime);
  app.set('settingsRepo', settingsRepo);
  app.set('eventRepo', eventRepo);
  app.set('themeRepo', themeRepo);
  app.set('photoRepo', photoRepo);

  // Middleware: cookie-parser and JSON body before routes.
  app.use(cookieParser());
  app.use(express.json());

  app.use('/api/health', healthRouter());
  app.use('/api/events', makePublicEventsRouter({ uploadRateMax }));
  app.use('/api/admin', makeAdminAuthRouter());
  app.use('/api/admin/events', requireAuth, makeAdminEventsRouter());
  app.use('/api/admin/themes', requireAuth, makeAdminThemesRouter());
  app.use('/api/admin', requireAuth, makeAdminSettingsRouter());
  app.use('/api/admin', requireAuth, makeAdminPhotosRouter());
  app.use('/api/admin', requireAuth, makeAdminExportRouter());
  app.use('/media', mediaRouter(config.dataDir));

  // Production SPA serving. Serve the built web app (web/dist) statically and
  // fall back to index.html for client-side routes (/e/:code, /e/:code/display,
  // /admin/*). Only wired when the build actually exists so dev/tests without a
  // build — and the API-only image — keep the prior API-only behavior (every
  // non-/api/non-/media route 404s as JSON).
  const indexHtml = path.join(config.webDir, 'index.html');
  if (existsSync(indexHtml)) {
    // Static assets (js/css/index.html). `index: false` so we control the SPA
    // fallback below rather than letting express.static serve index.html for
    // the bare GET / (we still want unknown asset paths to flow to the fallback).
    // Cache policy: hashed assets (index-<hash>.js/.css) are content-addressed,
    // so cache them long + immutable. index.html is the entry point and MUST
    // revalidate (no-cache) — otherwise after a deploy a client holding a stale
    // index.html would request now-deleted asset hashes and break for up to the
    // cache TTL.
    app.use(
      express.static(config.webDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    // SPA fallback: GET requests outside /api and /media that weren't served as
    // a static file get index.html so the client router can take over. Non-GET
    // and /api and /media requests fall through to the existing handlers (so an
    // unknown /api route still returns JSON 404 via the error handler).
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
      // Entry point must revalidate so deploys pick up fresh asset hashes.
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  } else if (config.nodeEnv !== 'test') {
    // eslint-disable-next-line no-console
    console.info(`[app] web build not found at ${config.webDir}; serving API only`);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
