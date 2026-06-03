import { Router, static as expressStatic } from 'express';
import { join } from 'node:path';

/** Serves derived media from `${dataDir}/media` under /media (e.g. /media/display/<file>). */
export function mediaRouter(dataDir: string): Router {
  const router = Router();
  router.use(
    expressStatic(join(dataDir, 'media'), {
      fallthrough: true,
      index: false,
      maxAge: '7d',
    }),
  );
  return router;
}
