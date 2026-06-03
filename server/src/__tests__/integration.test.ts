import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createServer, type Server as HttpServer } from 'node:http';
import { io as ioClient, type Socket } from 'socket.io-client';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openMemoryDb } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { makeSettingsRepo } from '../db/repositories/settingsRepo.js';
import { makeThemeRepo } from '../db/repositories/themeRepo.js';
import { initRealtime } from '../realtime/realtime.js';
import { DEFAULT_MOTION_CONFIG, DEFAULT_THEME_ID } from '@rtpa/shared';

// NOTE: The Plan 2 Task 11 snippet used `getDb(':memory:')` + `seed(db, config)`,
// but the real disk API is `openMemoryDb()` + `seed({ themeRepo, settingsRepo,
// sessionSecret })`. This test uses the real API so it actually runs.
function ctx() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = openMemoryDb();
  migrate(db);
  const settingsRepo = makeSettingsRepo(db);
  const themeRepo = makeThemeRepo(db);
  seed({ themeRepo, settingsRepo, sessionSecret: config.sessionSecret });
  return { db, config };
}

describe('full admin → public integration flow', () => {
  it('login → create event → update motion + theme → public by-code reflects it', async () => {
    const { db, config } = ctx();
    const app = buildApp({ db, config });
    const agent = request.agent(app);

    // login
    const login = await agent.post('/api/admin/login').send({ password: 'hunter2' });
    expect(login.status).toBe(200);

    // create event
    const created = await agent.post('/api/admin/events').send({ name: 'Integration Party' });
    expect(created.status).toBe(200);
    const { id, code } = created.body;
    expect(code).toBeTruthy();

    // update motion config
    const newCfg = { ...DEFAULT_MOTION_CONFIG, speed: 2.5, maxOnCanvas: 12 };
    const motion = await agent.put(`/api/admin/events/${id}/motion`).send({ motionConfig: newCfg });
    expect(motion.status).toBe(200);
    expect(motion.body.motionConfig.speed).toBe(2.5);

    // update theme
    const theme = await agent.put(`/api/admin/events/${id}/theme`).send({ themeId: DEFAULT_THEME_ID });
    expect(theme.status).toBe(200);
    expect(theme.body.themeId).toBe(DEFAULT_THEME_ID);

    // public by-code reflects the updated motion config + theme (no auth)
    const pub = await request(app).get(`/api/events/by-code/${code}`);
    expect(pub.status).toBe(200);
    expect(pub.body.motionConfig.speed).toBe(2.5);
    expect(pub.body.motionConfig.maxOnCanvas).toBe(12);
    expect(pub.body.theme.id).toBe(DEFAULT_THEME_ID);

    // admin endpoints reject unauthenticated callers
    const noAuth = await request(app).get('/api/admin/events');
    expect(noAuth.status).toBe(401);
  });
});

describe('realtime end-to-end (HTTP + WebSocket share one server)', () => {
  let httpServer: HttpServer | undefined;
  const clients: Socket[] = [];

  afterEach(async () => {
    clients.forEach((c) => c.disconnect());
    clients.length = 0;
    await new Promise<void>((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(() => resolve());
    });
    httpServer = undefined;
  });

  /** Resolve when `socket` receives `event`, reject if it doesn't within `ms`. */
  function waitFor<T>(socket: Socket, event: string, ms = 1500): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), ms);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('admin PUT motion broadcasts settings:updated to a joined client over the live socket', async () => {
    const { db, config } = ctx();

    // Wire exactly like production index.ts: bare http server, real emitters,
    // Express routed via httpServer.on('request', app), one port for both.
    httpServer = createServer();
    const realtime = initRealtime(httpServer);
    const app = buildApp({ db, config, realtime });
    httpServer.on('request', app);

    const port: number = await new Promise((resolve) => {
      httpServer!.listen(0, () => {
        const addr = httpServer!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    const url = `http://localhost:${port}`;

    // Admin: login + create event over real HTTP on the shared port.
    const agent = request.agent(url);
    await agent.post('/api/admin/login').send({ password: 'hunter2' });
    const created = await agent.post('/api/admin/events').send({ name: 'Live Party' });
    expect(created.status).toBe(200);
    const { id, code } = created.body;

    // Connect a socket.io client to the SAME server and join the event room.
    const client = ioClient(url, { transports: ['websocket'] });
    clients.push(client);
    await new Promise<void>((r) => client.on('connect', () => r()));
    client.emit('join', code);
    await sleep(50); // let server-side room join register

    const received = waitFor<typeof DEFAULT_MOTION_CONFIG>(client, 'settings:updated');

    // Admin updates the motion config → real broadcast over the live socket.
    const newCfg = { ...DEFAULT_MOTION_CONFIG, speed: 2.5, maxOnCanvas: 20 };
    const motion = await agent.put(`/api/admin/events/${id}/motion`).send({ motionConfig: newCfg });
    expect(motion.status).toBe(200);

    const payload = await received;
    expect(payload.speed).toBe(2.5);
    expect(payload.maxOnCanvas).toBe(20);
  });
});
