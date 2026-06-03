# RTPartyAlbum — Plan 2: Auth, Events API & Real-time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working, fully-tested admin + public REST API and a typed Socket.IO real-time server for RTPartyAlbum — authentication, event lifecycle, motion/theme/settings management, QR generation, and live broadcast — with **no media handling yet** (Plan 3).

**Architecture:** Builds on Plan 1's Express app (`buildApp`), config (`loadConfig`), and repositories (`settingsRepo`, `themeRepo`, `eventRepo`, `photoRepo`). Auth uses a bcrypt hash + JWT in an httpOnly cookie (`rtpa_session`). Routes call a **realtime registry** injected into `buildApp` so tests can pass a no-op; production wires the real Socket.IO helpers. All admin routers sit behind `requireAuth`; public read routes are open.

**Tech Stack:** Node 20, TypeScript ^5.4 (ESM), Express ^4.19, better-sqlite3 ^11, socket.io ^4.7, bcryptjs ^2.4, jsonwebtoken ^9, cookie-parser ^1.4, express-rate-limit ^7, qrcode ^1.5, zod ^3.23, nanoid ^5. Tests: Vitest ^2, supertest ^7, socket.io-client ^4.7, run via `tsx`.

---

## Realtime registry contract (used by every admin route that broadcasts)

To let routes call emit helpers while keeping `buildApp` testable, `buildApp` accepts a `realtime` object implementing the five emit helpers. The production wiring (Task 11) passes the real helpers from `realtime.ts`; tests pass either a no-op or a spy.

```ts
// shared shape consumed by routes (defined inline in app.ts BuildAppOptions)
export interface RealtimeEmitters {
  emitPhotoAdded(code: string, photo: import('@rtpa/shared').Photo): void;
  emitPhotoHidden(code: string, id: string): void;
  emitPhotoDeleted(code: string, id: string): void;
  emitSettingsUpdated(code: string, motionConfig: import('@rtpa/shared').MotionConfig): void;
  emitThemeUpdated(code: string, theme: import('@rtpa/shared').Theme): void;
}

export const noopRealtime: RealtimeEmitters = {
  emitPhotoAdded() {},
  emitPhotoHidden() {},
  emitPhotoDeleted() {},
  emitSettingsUpdated() {},
  emitThemeUpdated() {},
};
```

> **Assumption (stated):** Plan 1's `buildApp` signature is extended in this plan to accept `BuildAppOptions { realtime?: RealtimeEmitters }`, defaulting to `noopRealtime`. Routers read `req.app.get('realtime')` (set in `buildApp`). This is the minimal, locked way for routes to reach emit helpers per the contracts ("`app.ts` exposes a setter so routes can call helpers").

---

## Task 1 — Auth core (`src/auth/auth.ts`)

**Files:**
- Create: `server/src/auth/auth.ts`
- Test: `server/tests/auth.test.ts`

- [ ] Write failing test `server/tests/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import { makeSettingsRepo } from '../src/db/repositories/settingsRepo.js';
import { signSession, verifySession, ensureAdminBootstrap, requireAuth } from '../src/auth/auth.js';
import { SETTINGS_KEYS } from '@rtpa/shared';

function freshDb() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = getDb(':memory:');
  migrate(db);
  seed(db, config);
  return { db, config, settingsRepo: makeSettingsRepo(db) };
}

describe('auth core', () => {
  it('signs and verifies a session token', () => {
    const { settingsRepo } = freshDb();
    const token = signSession(settingsRepo);
    expect(typeof token).toBe('string');
    expect(verifySession(settingsRepo, token)).toBe(true);
    expect(verifySession(settingsRepo, token + 'tamper')).toBe(false);
    expect(verifySession(settingsRepo, 'not-a-jwt')).toBe(false);
  });

  it('bootstraps admin_password_hash from config on first run if absent', () => {
    const { settingsRepo, config } = freshDb();
    settingsRepo.set(SETTINGS_KEYS.adminPasswordHash, '');
    ensureAdminBootstrap(settingsRepo, config);
    const hash = settingsRepo.get(SETTINGS_KEYS.adminPasswordHash);
    expect(hash).toBeTruthy();
    expect(hash).not.toBe('hunter2'); // hashed, not plaintext
  });

  it('does not overwrite an existing hash on bootstrap', () => {
    const { settingsRepo, config } = freshDb();
    settingsRepo.set(SETTINGS_KEYS.adminPasswordHash, 'EXISTING_HASH');
    ensureAdminBootstrap(settingsRepo, config);
    expect(settingsRepo.get(SETTINGS_KEYS.adminPasswordHash)).toBe('EXISTING_HASH');
  });

  it('requireAuth allows with valid cookie and denies without', async () => {
    const { settingsRepo } = freshDb();
    const app = express();
    app.use(cookieParser());
    app.set('settingsRepo', settingsRepo);
    app.get('/protected', requireAuth, (_req, res) => res.json({ ok: true }));

    const token = signSession(settingsRepo);
    const denied = await request(app).get('/protected');
    expect(denied.status).toBe(401);

    const allowed = await request(app)
      .get('/protected')
      .set('Cookie', [`rtpa_session=${token}`]);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ ok: true });
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/auth.test.ts` — expect FAIL (module not found).
- [ ] Create `server/src/auth/auth.ts`:

```ts
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { SETTINGS_KEYS } from '@rtpa/shared';
import type { Config } from '../config.js';
import type { SettingsRepo } from '../db/repositories/settingsRepo.js';

export const SESSION_COOKIE = 'rtpa_session';
const SESSION_TTL = '7d';

function sessionSecret(settingsRepo: SettingsRepo): string {
  const secret = settingsRepo.get(SETTINGS_KEYS.sessionSecret);
  if (!secret) throw new Error('session secret missing');
  return secret;
}

/** Hash plaintext into a bcrypt hash and store it as the admin password hash. */
export function setAdminPassword(settingsRepo: SettingsRepo, plaintext: string): void {
  const hash = bcrypt.hashSync(plaintext, 10);
  settingsRepo.set(SETTINGS_KEYS.adminPasswordHash, hash);
}

/** Bootstrap admin_password_hash from config.adminPassword on first run if absent. */
export function ensureAdminBootstrap(settingsRepo: SettingsRepo, config: Config): void {
  const existing = settingsRepo.get(SETTINGS_KEYS.adminPasswordHash);
  if (existing && existing.length > 0) return;
  if (!config.adminPassword) return;
  setAdminPassword(settingsRepo, config.adminPassword);
}

/** Verify a plaintext password against the stored bcrypt hash. */
export function verifyPassword(settingsRepo: SettingsRepo, plaintext: string): boolean {
  const hash = settingsRepo.get(SETTINGS_KEYS.adminPasswordHash);
  if (!hash) return false;
  return bcrypt.compareSync(plaintext, hash);
}

/** Sign a JWT session token using the settings session secret. */
export function signSession(settingsRepo: SettingsRepo): string {
  return jwt.sign({ role: 'admin' }, sessionSecret(settingsRepo), { expiresIn: SESSION_TTL });
}

/** Verify a JWT session token; returns true if valid. */
export function verifySession(settingsRepo: SettingsRepo, token: string): boolean {
  try {
    jwt.verify(token, sessionSecret(settingsRepo));
    return true;
  } catch {
    return false;
  }
}

/** Express middleware: requires a valid rtpa_session cookie. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
  if (!token || !verifySession(settingsRepo, token)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
```

- [ ] Run `npm test -w @rtpa/server -- tests/auth.test.ts` — expect PASS.
- [ ] Commit: `feat(auth): bcrypt verify, JWT session sign/verify, bootstrap, requireAuth middleware`

---

## Task 2 — Auth routes (`src/routes/adminAuth.ts`) + cookie-parser wiring

**Files:**
- Create: `server/src/routes/adminAuth.ts`
- Modify: `server/src/app.ts` (add `cookie-parser`, mount auth router, set `settingsRepo` on app)
- Test: `server/tests/adminAuth.test.ts`

- [ ] Write failing test `server/tests/adminAuth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

function makeApp() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = getDb(':memory:');
  migrate(db);
  seed(db, config);
  return buildApp({ db, config });
}

describe('admin auth routes', () => {
  it('rejects wrong password with 401', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/admin/login').send({ password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('accepts right password and sets rtpa_session cookie', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/admin/login').send({ password: 'hunter2' });
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('rtpa_session='))).toBe(true);
    expect(cookies.some((c) => c.toLowerCase().includes('httponly'))).toBe(true);
  });

  it('GET /me returns 401 without cookie and 200 with cookie', async () => {
    const app = makeApp();
    const noCookie = await request(app).get('/api/admin/me');
    expect(noCookie.status).toBe(401);

    const login = await request(app).post('/api/admin/login').send({ password: 'hunter2' });
    const cookie = (login.headers['set-cookie'] as unknown as string[]);
    const me = await request(app).get('/api/admin/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ ok: true });
  });

  it('logout returns 204 and clears the cookie', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/admin/logout');
    expect(res.status).toBe(204);
  });

  it('rate-limits repeated login attempts with 429', async () => {
    const app = makeApp();
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await request(app).post('/api/admin/login').send({ password: 'nope' });
      last = res.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/adminAuth.test.ts` — expect FAIL (route + cookie-parser missing).
- [ ] Create `server/src/routes/adminAuth.ts`:

```ts
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  signSession,
  verifyPassword,
  requireAuth,
} from '../auth/auth.js';
import type { SettingsRepo } from '../db/repositories/settingsRepo.js';

const loginSchema = z.object({ password: z.string().min(1) });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' },
});

export function makeAdminAuthRouter(): Router {
  const router = Router();

  router.post('/login', loginLimiter, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    if (!verifyPassword(settingsRepo, parsed.data.password)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    const token = signSession(settingsRepo);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.app.get('env') === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.status(200).json({ ok: true });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return router;
}
```

- [ ] Modify `server/src/app.ts` — import `cookieParser` and the auth router, register them, and set `settingsRepo` on the app so `requireAuth` and routes can read it. Add at the top of `buildApp`:

```ts
import cookieParser from 'cookie-parser';
import { makeSettingsRepo } from './db/repositories/settingsRepo.js';
import { ensureAdminBootstrap } from './auth/auth.js';
import { makeAdminAuthRouter } from './routes/adminAuth.js';
// ...inside buildApp({ db, config, realtime = noopRealtime }):
const settingsRepo = makeSettingsRepo(db);
ensureAdminBootstrap(settingsRepo, config);
app.set('settingsRepo', settingsRepo);
app.set('realtime', realtime);
app.use(cookieParser());
// after app.use(express.json()):
app.use('/api/admin', makeAdminAuthRouter());
```

> **Note (Modify):** `cookieParser()` MUST be registered before any router using cookies. Extend `buildApp`'s options to `{ db, config, realtime = noopRealtime }` here (the `RealtimeEmitters`/`noopRealtime` defined in Task 5). For now define `noopRealtime` inline in `app.ts` if Task 5 not yet done, then import it in Task 5.

- [ ] Run `npm test -w @rtpa/server -- tests/adminAuth.test.ts` — expect PASS.
- [ ] Commit: `feat(auth): login/logout/me routes with rate limiting; wire cookie-parser`

---

## Task 3 — Event code generation (`src/services/eventCode.ts`)

**Files:**
- Create: `server/src/services/eventCode.ts`
- Test: `server/tests/eventCode.test.ts`

- [ ] Write failing test `server/tests/eventCode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateUniqueCode } from '../src/services/eventCode.js';

describe('generateUniqueCode', () => {
  it('returns a 6-char lowercase alphanumeric code', () => {
    const stub = { codeExists: () => false };
    const code = generateUniqueCode(stub);
    expect(code).toMatch(/^[0-9a-z]{6}$/);
  });

  it('retries when codeExists returns true, then succeeds', () => {
    let calls = 0;
    const stub = {
      codeExists: () => {
        calls += 1;
        return calls < 3; // first two collide, third is free
      },
    };
    const code = generateUniqueCode(stub);
    expect(code).toMatch(/^[0-9a-z]{6}$/);
    expect(calls).toBe(3);
  });

  it('throws after exhausting retries', () => {
    const stub = { codeExists: () => true };
    expect(() => generateUniqueCode(stub)).toThrow();
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/eventCode.test.ts` — expect FAIL.
- [ ] Create `server/src/services/eventCode.ts`:

```ts
import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 6;
const MAX_RETRIES = 20;
const nano = customAlphabet(ALPHABET, CODE_LENGTH);

export interface CodeChecker {
  codeExists(code: string): boolean;
}

/** Generate a unique 6-char lowercase alphanumeric event code, retrying on collision. */
export function generateUniqueCode(repo: CodeChecker): string {
  for (let i = 0; i < MAX_RETRIES; i++) {
    const code = nano();
    if (!repo.codeExists(code)) return code;
  }
  throw new Error('failed to generate unique event code');
}
```

- [ ] Run `npm test -w @rtpa/server -- tests/eventCode.test.ts` — expect PASS.
- [ ] Commit: `feat(events): unique event code generation with collision retry`

---

## Task 4 — Admin events routes (`src/routes/adminEvents.ts`)

**Files:**
- Create: `server/src/routes/adminEvents.ts`
- Test: `server/tests/adminEvents.test.ts`

- [ ] Write failing test `server/tests/adminEvents.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { DEFAULT_THEME_ID, DEFAULT_MOTION_CONFIG } from '@rtpa/shared';

function ctx() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = getDb(':memory:');
  migrate(db);
  seed(db, config);
  const app = buildApp({ db, config });
  return { app };
}

async function authedAgent(app: any) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return agent;
}

describe('admin events routes', () => {
  it('requires auth', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/admin/events');
    expect(res.status).toBe(401);
  });

  it('creates an event with defaults, generated code, and active status', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const res = await agent.post('/api/admin/events').send({ name: 'Sara Birthday' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Sara Birthday');
    expect(res.body.code).toMatch(/^[0-9a-z]{6}$/);
    expect(res.body.themeId).toBe(DEFAULT_THEME_ID);
    expect(res.body.motionConfig).toEqual(DEFAULT_MOTION_CONFIG);
    expect(res.body.isActive).toBe(true);
    expect(res.body.status).toBe('active');
  });

  it('rejects create with invalid body (zod) → 400', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const res = await agent.post('/api/admin/events').send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('lists events newest-first', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    await agent.post('/api/admin/events').send({ name: 'First' });
    await agent.post('/api/admin/events').send({ name: 'Second' });
    const res = await agent.get('/api/admin/events');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Second');
  });

  it('GET :id returns the event detail; 404 for unknown', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const created = await agent.post('/api/admin/events').send({ name: 'X' });
    const ok = await agent.get(`/api/admin/events/${created.body.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(created.body.id);
    const missing = await agent.get('/api/admin/events/nope');
    expect(missing.status).toBe(404);
  });

  it('activate pauses the previously-active event', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const a = await agent.post('/api/admin/events').send({ name: 'A' });
    const b = await agent.post('/api/admin/events').send({ name: 'B' }); // B now active
    const reA = await agent.post(`/api/admin/events/${a.body.id}/activate`);
    expect(reA.status).toBe(200);
    expect(reA.body.isActive).toBe(true);
    const bAfter = await agent.get(`/api/admin/events/${b.body.id}`);
    expect(bAfter.body.isActive).toBe(false);
    expect(bAfter.body.status).toBe('paused');
  });

  it('upload-state toggles upload_enabled', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const e = await agent.post('/api/admin/events').send({ name: 'E' });
    const res = await agent.post(`/api/admin/events/${e.body.id}/upload-state`).send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.uploadEnabled).toBe(false);
  });

  it('end sets status ended and disables uploads', async () => {
    const { app } = ctx();
    const agent = await authedAgent(app);
    const e = await agent.post('/api/admin/events').send({ name: 'E' });
    const res = await agent.post(`/api/admin/events/${e.body.id}/end`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ended');
    expect(res.body.isActive).toBe(false);
    expect(res.body.uploadEnabled).toBe(false);
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/adminEvents.test.ts` — expect FAIL.
- [ ] Create `server/src/routes/adminEvents.ts` (motion/theme/qr routes added in Tasks 6–7):

```ts
import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_THEME_ID, DEFAULT_MOTION_CONFIG } from '@rtpa/shared';
import type { EventRepo } from '../db/repositories/eventRepo.js';
import { generateUniqueCode } from '../services/eventCode.js';

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });
const uploadStateSchema = z.object({ enabled: z.boolean() });

export function makeAdminEventsRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    res.json(eventRepo.list());
  });

  router.post('/', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const code = generateUniqueCode(eventRepo);
    const event = eventRepo.create({
      name: parsed.data.name,
      code,
      themeId: DEFAULT_THEME_ID,
      motionConfig: DEFAULT_MOTION_CONFIG,
    });
    eventRepo.activate(event.id); // pauses others
    res.json(eventRepo.getById(event.id));
  });

  router.get('/:id', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const event = eventRepo.getById(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(event);
  });

  router.post('/:id/activate', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    if (!eventRepo.getById(req.params.id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    eventRepo.activate(req.params.id);
    res.json(eventRepo.getById(req.params.id));
  });

  router.post('/:id/upload-state', (req, res) => {
    const parsed = uploadStateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    if (!eventRepo.getById(req.params.id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    eventRepo.setUploadEnabled(req.params.id, parsed.data.enabled);
    res.json(eventRepo.getById(req.params.id));
  });

  router.post('/:id/end', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    if (!eventRepo.getById(req.params.id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    eventRepo.end(req.params.id);
    res.json(eventRepo.getById(req.params.id));
  });

  return router;
}
```

- [ ] Modify `server/src/app.ts` — instantiate `eventRepo` and `themeRepo`, set them on the app, and mount the router behind `requireAuth`. Add inside `buildApp`:

```ts
import { makeEventRepo } from './db/repositories/eventRepo.js';
import { makeThemeRepo } from './db/repositories/themeRepo.js';
import { makeAdminEventsRouter } from './routes/adminEvents.js';
import { requireAuth } from './auth/auth.js';
// ...
const eventRepo = makeEventRepo(db);
const themeRepo = makeThemeRepo(db);
app.set('eventRepo', eventRepo);
app.set('themeRepo', themeRepo);
app.use('/api/admin/events', requireAuth, makeAdminEventsRouter());
```

- [ ] Run `npm test -w @rtpa/server -- tests/adminEvents.test.ts` — expect PASS.
- [ ] Commit: `feat(events): admin events CRUD + lifecycle routes (list/create/activate/upload-state/end)`

---

## Task 5 — Real-time server (`src/realtime/realtime.ts`)

**Files:**
- Create: `server/src/realtime/realtime.ts`
- Modify: `server/src/app.ts` (export `RealtimeEmitters` + `noopRealtime`, use as `buildApp` default)
- Test: `server/tests/realtime.test.ts`

- [ ] Write failing test `server/tests/realtime.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { io as ioClient, type Socket } from 'socket.io-client';
import { initRealtime } from '../src/realtime/realtime.js';
import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';

let httpServer: HttpServer;
const clients: Socket[] = [];

afterEach(() => {
  clients.forEach((c) => c.disconnect());
  clients.length = 0;
  httpServer?.close();
});

function start(): Promise<{ url: string; rt: ReturnType<typeof initRealtime> }> {
  return new Promise((resolve) => {
    httpServer = createServer();
    const rt = initRealtime(httpServer);
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://localhost:${port}`, rt });
    });
  });
}

describe('realtime', () => {
  it('delivers settings:updated only to clients joined to the matching room', async () => {
    const { url, rt } = await start();

    const inRoom = ioClient(url, { transports: ['websocket'] });
    const otherRoom = ioClient(url, { transports: ['websocket'] });
    clients.push(inRoom, otherRoom);

    await new Promise<void>((r) => inRoom.on('connect', () => r()));
    await new Promise<void>((r) => otherRoom.on('connect', () => r()));

    inRoom.emit('join', 'abc123');
    otherRoom.emit('join', 'zzz999');
    await new Promise((r) => setTimeout(r, 50)); // let joins register

    const received = new Promise<any>((resolve) => {
      inRoom.on('settings:updated', (cfg) => resolve(cfg));
    });
    let otherGot = false;
    otherRoom.on('settings:updated', () => { otherGot = true; });

    rt.emitSettingsUpdated('abc123', DEFAULT_MOTION_CONFIG);

    const cfg = await received;
    expect(cfg).toEqual(DEFAULT_MOTION_CONFIG);
    await new Promise((r) => setTimeout(r, 50));
    expect(otherGot).toBe(false);
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/realtime.test.ts` — expect FAIL.
- [ ] Create `server/src/realtime/realtime.ts`:

```ts
import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  Photo,
  MotionConfig,
  Theme,
} from '@rtpa/shared';

export interface RealtimeEmitters {
  emitPhotoAdded(code: string, photo: Photo): void;
  emitPhotoHidden(code: string, id: string): void;
  emitPhotoDeleted(code: string, id: string): void;
  emitSettingsUpdated(code: string, motionConfig: MotionConfig): void;
  emitThemeUpdated(code: string, theme: Theme): void;
}

const room = (code: string) => `event:${code}`;

/** Attach a typed Socket.IO server to the HTTP server and return emit helpers. */
export function initRealtime(httpServer: HttpServer): RealtimeEmitters {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true, credentials: true },
  });

  io.on('connection', (socket) => {
    socket.on('join', (eventCode: string) => {
      socket.join(room(eventCode));
    });
  });

  return {
    emitPhotoAdded(code, photo) {
      io.to(room(code)).emit('photo:added', photo);
    },
    emitPhotoHidden(code, id) {
      io.to(room(code)).emit('photo:hidden', { id });
    },
    emitPhotoDeleted(code, id) {
      io.to(room(code)).emit('photo:deleted', { id });
    },
    emitSettingsUpdated(code, motionConfig) {
      io.to(room(code)).emit('settings:updated', motionConfig);
    },
    emitThemeUpdated(code, theme) {
      io.to(room(code)).emit('theme:updated', theme);
    },
  };
}
```

- [ ] Modify `server/src/app.ts` — replace any inline noop with the canonical `noopRealtime` (re-using the `RealtimeEmitters` type from `realtime.ts`). Add near the top of `app.ts`:

```ts
import type { RealtimeEmitters } from './realtime/realtime.js';

export const noopRealtime: RealtimeEmitters = {
  emitPhotoAdded() {},
  emitPhotoHidden() {},
  emitPhotoDeleted() {},
  emitSettingsUpdated() {},
  emitThemeUpdated() {},
};
```

And ensure `buildApp` reads `{ db, config, realtime = noopRealtime }` and calls `app.set('realtime', realtime)`.

- [ ] Run `npm test -w @rtpa/server -- tests/realtime.test.ts` — expect PASS.
- [ ] Commit: `feat(realtime): typed Socket.IO server, room-per-event join, emit helpers`

---

## Task 6 — Motion + theme update routes (in `adminEvents.ts`) with broadcast

**Files:**
- Modify: `server/src/routes/adminEvents.ts` (add `PUT :id/motion`, `PUT :id/theme`)
- Test: `server/tests/adminEventsBroadcast.test.ts`

- [ ] Write failing test `server/tests/adminEventsBroadcast.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { DEFAULT_MOTION_CONFIG, DEFAULT_THEME_ID } from '@rtpa/shared';

function ctx() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = getDb(':memory:');
  migrate(db);
  seed(db, config);
  const realtime = {
    emitPhotoAdded: vi.fn(),
    emitPhotoHidden: vi.fn(),
    emitPhotoDeleted: vi.fn(),
    emitSettingsUpdated: vi.fn(),
    emitThemeUpdated: vi.fn(),
  };
  const app = buildApp({ db, config, realtime });
  return { app, realtime };
}

async function authed(app: any) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return agent;
}

describe('motion + theme update broadcasts', () => {
  it('PUT motion validates, persists, and broadcasts settings:updated with the code', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const newCfg = { ...DEFAULT_MOTION_CONFIG, speed: 2, maxOnCanvas: 30 };
    const res = await agent.put(`/api/admin/events/${e.id}/motion`).send({ motionConfig: newCfg });
    expect(res.status).toBe(200);
    expect(res.body.motionConfig.speed).toBe(2);
    expect(realtime.emitSettingsUpdated).toHaveBeenCalledWith(e.code, expect.objectContaining({ speed: 2 }));
  });

  it('PUT motion rejects invalid config → 400, no broadcast', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const res = await agent.put(`/api/admin/events/${e.id}/motion`).send({ motionConfig: { speed: 'fast' } });
    expect(res.status).toBe(400);
    expect(realtime.emitSettingsUpdated).not.toHaveBeenCalled();
  });

  it('PUT theme persists and broadcasts theme:updated', async () => {
    const { app, realtime } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const res = await agent.put(`/api/admin/events/${e.id}/theme`).send({ themeId: DEFAULT_THEME_ID });
    expect(res.status).toBe(200);
    expect(res.body.themeId).toBe(DEFAULT_THEME_ID);
    expect(realtime.emitThemeUpdated).toHaveBeenCalledWith(e.code, expect.objectContaining({ id: DEFAULT_THEME_ID }));
  });

  it('PUT theme with unknown themeId → 404', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const res = await agent.put(`/api/admin/events/${e.id}/theme`).send({ themeId: 'no-such-theme' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/adminEventsBroadcast.test.ts` — expect FAIL.
- [ ] Modify `server/src/routes/adminEvents.ts` — add the zod schema and two routes. Add imports and schemas at the top:

```ts
import type { ThemeRepo } from '../db/repositories/themeRepo.js';
import type { RealtimeEmitters } from '../realtime/realtime.js';

const motionConfigSchema = z.object({
  motionWeights: z.object({
    drift: z.number(),
    current: z.number(),
    orbit: z.number(),
    mosaic: z.number(),
  }),
  speed: z.number().min(0.25).max(3),
  maxOnCanvas: z.number().int().positive(),
  dwell: z.object({
    enabled: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    varianceMs: z.number().int().nonnegative(),
  }),
  enterWeights: z.object({
    flyInEdge: z.number(),
    scalePop: z.number(),
    fadeGrow: z.number(),
    spinIn: z.number(),
    dropBounce: z.number(),
  }),
  leaveWeights: z.object({
    driftOffEdge: z.number(),
    shrinkFade: z.number(),
    spinOut: z.number(),
    slideAway: z.number(),
  }),
  baseSize: z.number().positive(),
  sizeVariance: z.number().min(0).max(1),
});

const motionSchema = z.object({ motionConfig: motionConfigSchema });
const themeUpdateSchema = z.object({ themeId: z.string().min(1) });
```

Add these routes inside `makeAdminEventsRouter()` (before `return router;`):

```ts
  router.put('/:id/motion', (req, res) => {
    const parsed = motionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const realtime = req.app.get('realtime') as RealtimeEmitters;
    const event = eventRepo.getById(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    eventRepo.setMotionConfig(req.params.id, parsed.data.motionConfig);
    realtime.emitSettingsUpdated(event.code, parsed.data.motionConfig);
    res.json(eventRepo.getById(req.params.id));
  });

  router.put('/:id/theme', (req, res) => {
    const parsed = themeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    const realtime = req.app.get('realtime') as RealtimeEmitters;
    const event = eventRepo.getById(req.params.id);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const theme = themeRepo.getById(parsed.data.themeId);
    if (!theme) {
      res.status(404).json({ error: 'theme_not_found' });
      return;
    }
    eventRepo.setTheme(req.params.id, theme.id);
    realtime.emitThemeUpdated(event.code, theme);
    res.json(eventRepo.getById(req.params.id));
  });
```

- [ ] Run `npm test -w @rtpa/server -- tests/adminEventsBroadcast.test.ts` — expect PASS.
- [ ] Commit: `feat(events): motion + theme update routes with live broadcast`

---

## Task 7 — QR route (`GET /api/admin/events/:id/qr`)

**Files:**
- Modify: `server/src/routes/adminEvents.ts` (add `GET :id/qr`)
- Test: `server/tests/adminEventsQr.test.ts`

- [ ] Write failing test `server/tests/adminEventsQr.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { makeSettingsRepo } from '../src/db/repositories/settingsRepo.js';
import { SETTINGS_KEYS } from '@rtpa/shared';

function ctx() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = getDb(':memory:');
  migrate(db);
  seed(db, config);
  makeSettingsRepo(db).set(SETTINGS_KEYS.publicBaseUrl, 'https://party.example.com');
  return { app: buildApp({ db, config }) };
}

async function authed(app: any) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return agent;
}

describe('QR route', () => {
  it('returns a PNG image for an existing event', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const e = (await agent.post('/api/admin/events').send({ name: 'E' })).body;
    const res = await agent.get(`/api/admin/events/${e.id}/qr`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('404s for a missing event', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.get('/api/admin/events/nope/qr');
    expect(res.status).toBe(404);
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/adminEventsQr.test.ts` — expect FAIL.
- [ ] Modify `server/src/routes/adminEvents.ts` — add the import and route. Add near the top:

```ts
import QRCode from 'qrcode';
import { SETTINGS_KEYS } from '@rtpa/shared';
import type { SettingsRepo } from '../db/repositories/settingsRepo.js';
```

Add inside `makeAdminEventsRouter()` (before `return router;`):

```ts
  router.get('/:id/qr', async (req, res, next) => {
    try {
      const eventRepo = req.app.get('eventRepo') as EventRepo;
      const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
      const event = eventRepo.getById(req.params.id);
      if (!event) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const baseUrl = (settingsRepo.get(SETTINGS_KEYS.publicBaseUrl) ?? '').replace(/\/+$/, '');
      const url = `${baseUrl}/e/${event.code}`;
      const png = await QRCode.toBuffer(url, { type: 'png', width: 512, margin: 2 });
      res.setHeader('Content-Type', 'image/png');
      res.send(png);
    } catch (err) {
      next(err);
    }
  });
```

- [ ] Run `npm test -w @rtpa/server -- tests/adminEventsQr.test.ts` — expect PASS.
- [ ] Commit: `feat(events): QR PNG generation from public base URL + event code`

---

## Task 8 — Admin themes CRUD (`src/routes/adminThemes.ts`)

**Files:**
- Create: `server/src/routes/adminThemes.ts`
- Modify: `server/src/app.ts` (mount router behind `requireAuth`)
- Test: `server/tests/adminThemes.test.ts`

- [ ] Write failing test `server/tests/adminThemes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { DEFAULT_THEME_ID } from '@rtpa/shared';

function ctx() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = getDb(':memory:');
  migrate(db);
  seed(db, config);
  return { app: buildApp({ db, config }) };
}

async function authed(app: any) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return agent;
}

const tokens = {
  background: { type: 'solid', value: '#101015' },
  ambient: 'glow',
  frame: { style: 'rounded', borderColor: '#fff', borderWidth: 2, radius: 12, shadow: true },
  caption: { enabled: true, bg: '#000', color: '#fff' },
  font: 'Inter',
  accent: '#e0b',
};

describe('admin themes CRUD', () => {
  it('lists seeded preset themes', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.get('/api/admin/themes');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(9);
  });

  it('creates a custom theme (isPreset false)', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.post('/api/admin/themes').send({ name: 'My Theme', tokens });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('My Theme');
    expect(res.body.isPreset).toBe(false);
    expect(res.body.id).toBeTruthy();
  });

  it('updates a custom theme', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const created = (await agent.post('/api/admin/themes').send({ name: 'A', tokens })).body;
    const res = await agent.put(`/api/admin/themes/${created.id}`).send({ name: 'B' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('B');
  });

  it('deletes a custom theme → 204', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const created = (await agent.post('/api/admin/themes').send({ name: 'Del', tokens })).body;
    const res = await agent.delete(`/api/admin/themes/${created.id}`);
    expect(res.status).toBe(204);
  });

  it('refuses to delete a preset → 409', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.delete(`/api/admin/themes/${DEFAULT_THEME_ID}`);
    expect(res.status).toBe(409);
  });

  it('requires auth', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/admin/themes');
    expect(res.status).toBe(401);
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/adminThemes.test.ts` — expect FAIL.
- [ ] Create `server/src/routes/adminThemes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import type { ThemeRepo } from '../db/repositories/themeRepo.js';

const themeTokensSchema = z.object({
  background: z.object({
    type: z.enum(['solid', 'gradient', 'image']),
    value: z.string(),
  }),
  ambient: z.enum(['none', 'bokeh', 'particles', 'glow']),
  frame: z.object({
    style: z.enum(['thin', 'polaroid', 'rounded', 'none']),
    borderColor: z.string(),
    borderWidth: z.number(),
    radius: z.number(),
    shadow: z.boolean(),
  }),
  caption: z.object({
    enabled: z.boolean(),
    bg: z.string(),
    color: z.string(),
  }),
  font: z.string(),
  accent: z.string(),
});

const createSchema = z.object({ name: z.string().trim().min(1), tokens: themeTokensSchema });
const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  tokens: themeTokensSchema.optional(),
});

export function makeAdminThemesRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    res.json(themeRepo.list());
  });

  router.post('/', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    res.json(themeRepo.create(parsed.data));
  });

  router.put('/:id', (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    const updated = themeRepo.update(req.params.id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(updated);
  });

  router.delete('/:id', (req, res) => {
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    const theme = themeRepo.getById(req.params.id);
    if (!theme) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const removed = themeRepo.remove(req.params.id); // false if preset
    if (!removed) {
      res.status(409).json({ error: 'preset_immutable' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
```

- [ ] Modify `server/src/app.ts` — mount the themes router. Add:

```ts
import { makeAdminThemesRouter } from './routes/adminThemes.js';
// ...
app.use('/api/admin/themes', requireAuth, makeAdminThemesRouter());
```

- [ ] Run `npm test -w @rtpa/server -- tests/adminThemes.test.ts` — expect PASS.
- [ ] Commit: `feat(themes): admin themes CRUD with preset-delete protection`

---

## Task 9 — Admin settings (`src/routes/adminSettings.ts`)

**Files:**
- Create: `server/src/routes/adminSettings.ts`
- Modify: `server/src/app.ts` (mount router behind `requireAuth`)
- Test: `server/tests/adminSettings.test.ts`

- [ ] Write failing test `server/tests/adminSettings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { DEFAULT_MEDIA_LIMITS } from '@rtpa/shared';

function ctx() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = getDb(':memory:');
  migrate(db);
  seed(db, config);
  return { app: buildApp({ db, config }) };
}

async function authed(app: any) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return agent;
}

describe('admin settings', () => {
  it('GET returns publicBaseUrl + mediaLimits', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.get('/api/admin/settings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('publicBaseUrl');
    expect(res.body.mediaLimits).toEqual(DEFAULT_MEDIA_LIMITS);
  });

  it('PUT updates publicBaseUrl and mediaLimits', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.put('/api/admin/settings').send({
      publicBaseUrl: 'https://x.example.com',
      mediaLimits: { photoMaxBytes: 1000, videoMaxBytes: 2000, videoMaxDurationSec: 10 },
    });
    expect(res.status).toBe(200);
    expect(res.body.publicBaseUrl).toBe('https://x.example.com');
    expect(res.body.mediaLimits.photoMaxBytes).toBe(1000);
  });

  it('PUT rejects invalid mediaLimits → 400', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.put('/api/admin/settings').send({ mediaLimits: { photoMaxBytes: -5 } });
    expect(res.status).toBe(400);
  });

  it('POST password changes hash when current is correct', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const ok = await agent.post('/api/admin/password').send({ current: 'hunter2', next: 'newpass1' });
    expect(ok.status).toBe(204);
    // old password now fails
    const bad = await request(app).post('/api/admin/login').send({ password: 'hunter2' });
    expect(bad.status).toBe(401);
    const good = await request(app).post('/api/admin/login').send({ password: 'newpass1' });
    expect(good.status).toBe(200);
  });

  it('POST password rejects wrong current → 401', async () => {
    const { app } = ctx();
    const agent = await authed(app);
    const res = await agent.post('/api/admin/password').send({ current: 'wrong', next: 'newpass1' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/adminSettings.test.ts` — expect FAIL.
- [ ] Create `server/src/routes/adminSettings.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { SETTINGS_KEYS, DEFAULT_MEDIA_LIMITS, type MediaLimits } from '@rtpa/shared';
import type { SettingsRepo } from '../db/repositories/settingsRepo.js';
import { verifyPassword, setAdminPassword } from '../auth/auth.js';

const mediaLimitsSchema = z.object({
  photoMaxBytes: z.number().int().positive(),
  videoMaxBytes: z.number().int().positive(),
  videoMaxDurationSec: z.number().int().positive(),
});

const updateSchema = z.object({
  publicBaseUrl: z.string().optional(),
  mediaLimits: mediaLimitsSchema.optional(),
});

const passwordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(6),
});

function readSettings(settingsRepo: SettingsRepo) {
  const publicBaseUrl = settingsRepo.get(SETTINGS_KEYS.publicBaseUrl) ?? '';
  const mediaLimits =
    settingsRepo.getJson<MediaLimits>(SETTINGS_KEYS.mediaLimits) ?? DEFAULT_MEDIA_LIMITS;
  return { publicBaseUrl, mediaLimits };
}

export function makeAdminSettingsRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    res.json(readSettings(settingsRepo));
  });

  router.put('/', (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    if (parsed.data.publicBaseUrl !== undefined) {
      settingsRepo.set(SETTINGS_KEYS.publicBaseUrl, parsed.data.publicBaseUrl);
    }
    if (parsed.data.mediaLimits !== undefined) {
      settingsRepo.setJson(SETTINGS_KEYS.mediaLimits, parsed.data.mediaLimits);
    }
    res.json(readSettings(settingsRepo));
  });

  router.post('/password', (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const settingsRepo = req.app.get('settingsRepo') as SettingsRepo;
    if (!verifyPassword(settingsRepo, parsed.data.current)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    setAdminPassword(settingsRepo, parsed.data.next);
    res.status(204).end();
  });

  return router;
}
```

- [ ] Modify `server/src/app.ts` — mount the settings router. The password route lives at `/api/admin/password`, so mount the router at `/api/admin`:

```ts
import { makeAdminSettingsRouter } from './routes/adminSettings.js';
// ...
app.use('/api/admin/settings', requireAuth, makeAdminSettingsRouter()); // GET/PUT '/'
app.use('/api/admin', requireAuth, makeAdminSettingsRouter());          // POST '/password'
```

> **Note (Modify):** Mount twice as shown so both `/api/admin/settings` (GET/PUT `/`) and `/api/admin/password` (POST `/password`) resolve from the single router. Ensure this is registered AFTER `makeAdminAuthRouter()` so the auth router's `/login`, `/logout`, `/me` are matched first (they are distinct paths, so order is safe either way).

- [ ] Run `npm test -w @rtpa/server -- tests/adminSettings.test.ts` — expect PASS.
- [ ] Commit: `feat(settings): admin settings get/put + password change`

---

## Task 10 — Public events read (`src/routes/publicEvents.ts`)

**Files:**
- Create: `server/src/routes/publicEvents.ts`
- Modify: `server/src/app.ts` (mount public router — NO auth)
- Test: `server/tests/publicEvents.test.ts`

- [ ] Write failing test `server/tests/publicEvents.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { DEFAULT_THEME_ID } from '@rtpa/shared';

function ctx() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = getDb(':memory:');
  migrate(db);
  seed(db, config);
  return { app: buildApp({ db, config }) };
}

async function createEvent(app: any) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'hunter2' });
  return (await agent.post('/api/admin/events').send({ name: 'Public E' })).body;
}

describe('public events read', () => {
  it('GET by-code returns PublicEvent with theme + motionConfig (no auth)', async () => {
    const { app } = ctx();
    const e = await createEvent(app);
    const res = await request(app).get(`/api/events/by-code/${e.code}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(e.code);
    expect(res.body.name).toBe('Public E');
    expect(res.body.uploadEnabled).toBe(true);
    expect(res.body.theme.id).toBe(DEFAULT_THEME_ID);
    expect(res.body.motionConfig).toBeTruthy();
    expect(res.body).not.toHaveProperty('id'); // PublicEvent shape, no internal id
  });

  it('GET by-code 404 for unknown code', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/events/by-code/zzzzzz');
    expect(res.status).toBe(404);
  });

  it('GET by-code photos returns an array (empty until Plan 3)', async () => {
    const { app } = ctx();
    const e = await createEvent(app);
    const res = await request(app).get(`/api/events/by-code/${e.code}/photos`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('GET by-code photos 404 for unknown code', async () => {
    const { app } = ctx();
    const res = await request(app).get('/api/events/by-code/zzzzzz/photos');
    expect(res.status).toBe(404);
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/publicEvents.test.ts` — expect FAIL.
- [ ] Create `server/src/routes/publicEvents.ts`:

```ts
import { Router } from 'express';
import type { PublicEvent } from '@rtpa/shared';
import { DEFAULT_THEME_ID } from '@rtpa/shared';
import type { EventRepo } from '../db/repositories/eventRepo.js';
import type { ThemeRepo } from '../db/repositories/themeRepo.js';
import type { PhotoRepo } from '../db/repositories/photoRepo.js';

export function makePublicEventsRouter(): Router {
  const router = Router();

  router.get('/by-code/:code', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const themeRepo = req.app.get('themeRepo') as ThemeRepo;
    const event = eventRepo.getByCode(req.params.code);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const theme = themeRepo.getById(event.themeId) ?? themeRepo.getById(DEFAULT_THEME_ID)!;
    const publicEvent: PublicEvent = {
      code: event.code,
      name: event.name,
      status: event.status,
      uploadEnabled: event.uploadEnabled,
      theme,
      motionConfig: event.motionConfig,
    };
    res.json(publicEvent);
  });

  router.get('/by-code/:code/photos', (req, res) => {
    const eventRepo = req.app.get('eventRepo') as EventRepo;
    const photoRepo = req.app.get('photoRepo') as PhotoRepo;
    const event = eventRepo.getByCode(req.params.code);
    if (!event) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(photoRepo.listForEventPublic(event.id));
  });

  return router;
}
```

- [ ] Modify `server/src/app.ts` — instantiate `photoRepo`, set it on the app, and mount the public router (no `requireAuth`). Add:

```ts
import { makePhotoRepo } from './db/repositories/photoRepo.js';
import { makePublicEventsRouter } from './routes/publicEvents.js';
// ...
const photoRepo = makePhotoRepo(db);
app.set('photoRepo', photoRepo);
app.use('/api/events', makePublicEventsRouter());
```

- [ ] Run `npm test -w @rtpa/server -- tests/publicEvents.test.ts` — expect PASS.
- [ ] Commit: `feat(public): public event read routes (by-code, photos)`

---

## Task 11 — Final wiring + full integration test

**Files:**
- Modify: `server/src/app.ts` (confirm full `buildApp` assembly + `requireAuth` on every admin router)
- Modify: `server/src/index.ts` (call `initRealtime` and pass emitters into `buildApp`)
- Test: `server/tests/integration.test.ts`

- [ ] Confirm `server/src/app.ts` final shape. The complete `buildApp` should read:

```ts
import express from 'express';
import cookieParser from 'cookie-parser';
import type { Database } from 'better-sqlite3';
import type { Config } from './config.js';
import type { RealtimeEmitters } from './realtime/realtime.js';
import { makeSettingsRepo } from './db/repositories/settingsRepo.js';
import { makeThemeRepo } from './db/repositories/themeRepo.js';
import { makeEventRepo } from './db/repositories/eventRepo.js';
import { makePhotoRepo } from './db/repositories/photoRepo.js';
import { ensureAdminBootstrap } from './auth/auth.js';
import { requireAuth } from './auth/auth.js';
import { makeHealthRouter } from './routes/health.js';
import { makeAdminAuthRouter } from './routes/adminAuth.js';
import { makeAdminEventsRouter } from './routes/adminEvents.js';
import { makeAdminThemesRouter } from './routes/adminThemes.js';
import { makeAdminSettingsRouter } from './routes/adminSettings.js';
import { makePublicEventsRouter } from './routes/publicEvents.js';
import { errorHandler } from './middleware/errorHandler.js';

export const noopRealtime: RealtimeEmitters = {
  emitPhotoAdded() {},
  emitPhotoHidden() {},
  emitPhotoDeleted() {},
  emitSettingsUpdated() {},
  emitThemeUpdated() {},
};

export interface BuildAppOptions {
  db: Database;
  config: Config;
  realtime?: RealtimeEmitters;
}

export function buildApp({ db, config, realtime = noopRealtime }: BuildAppOptions) {
  const app = express();

  const settingsRepo = makeSettingsRepo(db);
  const themeRepo = makeThemeRepo(db);
  const eventRepo = makeEventRepo(db);
  const photoRepo = makePhotoRepo(db);
  ensureAdminBootstrap(settingsRepo, config);

  app.set('settingsRepo', settingsRepo);
  app.set('themeRepo', themeRepo);
  app.set('eventRepo', eventRepo);
  app.set('photoRepo', photoRepo);
  app.set('realtime', realtime);

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/health', makeHealthRouter());

  // Public (no auth)
  app.use('/api/events', makePublicEventsRouter());

  // Admin auth (login is open + rate-limited; /me uses requireAuth internally)
  app.use('/api/admin', makeAdminAuthRouter());

  // Admin protected routers
  app.use('/api/admin/events', requireAuth, makeAdminEventsRouter());
  app.use('/api/admin/themes', requireAuth, makeAdminThemesRouter());
  app.use('/api/admin/settings', requireAuth, makeAdminSettingsRouter());
  app.use('/api/admin', requireAuth, makeAdminSettingsRouter()); // POST /password

  app.use(errorHandler);
  return app;
}
```

> **Note (Modify):** Keep Plan 1's existing `health` router (`makeHealthRouter` or equivalent) — adjust the import to whatever Plan 1 exported. If Plan 1's `buildApp` already created repos, reuse those lines rather than duplicating. The mount order above is correct: public first, then auth router (open `/login`), then protected admin routers.

- [ ] Modify `server/src/index.ts` — create the HTTP server, attach realtime, pass emitters to `buildApp`. The entry should read:

```ts
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { getDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { buildApp } from './app.js';
import { initRealtime } from './realtime/realtime.js';

const config = loadConfig();
const db = getDb();
migrate(db);
seed(db, config);

// Create HTTP server first so realtime can attach to it, then build app with emitters.
const httpServer = createServer();
const realtime = initRealtime(httpServer);
const app = buildApp({ db, config, realtime });
httpServer.on('request', app);

httpServer.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`RTPartyAlbum server listening on :${config.port}`);
});
```

> **Note (Modify):** `initRealtime` attaches Socket.IO to the bare `httpServer`; `httpServer.on('request', app)` routes plain HTTP to Express. This ordering ensures Socket.IO's upgrade handler is installed before Express handles requests. Adjust `getDb()`/`migrate()`/`seed()` calls to match Plan 1's exact signatures.

- [ ] Write failing integration test `server/tests/integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';

function ctx() {
  const config = loadConfig({ nodeEnv: 'test', dataDir: ':memory:', adminPassword: 'hunter2' });
  const db = getDb(':memory:');
  migrate(db);
  seed(db, config);
  return { app: buildApp({ db, config }) };
}

describe('full admin → public integration flow', () => {
  it('login → create event → update motion → public by-code reflects it', async () => {
    const { app } = ctx();
    const agent = request.agent(app);

    // login
    const login = await agent.post('/api/admin/login').send({ password: 'hunter2' });
    expect(login.status).toBe(200);

    // create event
    const created = await agent.post('/api/admin/events').send({ name: 'Integration Party' });
    expect(created.status).toBe(200);
    const { id, code } = created.body;

    // update motion
    const newCfg = { ...DEFAULT_MOTION_CONFIG, speed: 2.5, maxOnCanvas: 12 };
    const motion = await agent.put(`/api/admin/events/${id}/motion`).send({ motionConfig: newCfg });
    expect(motion.status).toBe(200);
    expect(motion.body.motionConfig.speed).toBe(2.5);

    // public by-code reflects the updated motion config (no auth)
    const pub = await request(app).get(`/api/events/by-code/${code}`);
    expect(pub.status).toBe(200);
    expect(pub.body.motionConfig.speed).toBe(2.5);
    expect(pub.body.motionConfig.maxOnCanvas).toBe(12);

    // admin endpoints reject unauthenticated callers
    const noAuth = await request(app).get('/api/admin/events');
    expect(noAuth.status).toBe(401);
  });
});
```

- [ ] Run `npm test -w @rtpa/server -- tests/integration.test.ts` — expect FAIL (until wiring confirmed), then resolve any wiring gaps.
- [ ] Run the full server suite: `npm test -w @rtpa/server` — expect ALL PASS.
- [ ] Commit: `feat(server): wire all routers + realtime; full admin→public integration test`

---

## Plan 2 self-check

Maps spec/contracts items to the tasks that deliver them:

| Spec / contract item | Covered by |
|---|---|
| Admin password hashed (bcrypt), httpOnly cookie, login rate-limited (§13) | Tasks 1, 2 |
| `ADMIN_PASSWORD` bootstrap → hashed on first run (§4, §14) | Task 1 (`ensureAdminBootstrap`) |
| JWT session sign/verify on `session_secret` (contracts `SETTINGS_KEYS.sessionSecret`) | Task 1 |
| Auth API: `POST /login`, `POST /logout`, `GET /me` | Task 2 |
| `cookie-parser` wiring (contracts Socket.IO/app note) | Task 2 |
| Auto-generated short `code` (§6, §11) | Task 3 (`eventCode.ts`, nanoid len 6) |
| Events admin API list/create/:id/activate/upload-state/end | Task 4 |
| Create uses `DEFAULT_THEME_ID` + `DEFAULT_MOTION_CONFIG`, activates (pauses others) (§3, §11, §15) | Task 4 |
| One active at a time; activating pauses others (§3, contracts `eventRepo.activate`) | Task 4 (test asserts) |
| Socket.IO room-per-event, typed events, 5 emit helpers (§4, §12, contracts) | Task 5 |
| Realtime registry injected into `buildApp`; tests pass no-op (contracts) | Tasks 2, 5, 11 |
| `settings:updated` / `theme:updated` broadcast on change (§8, §9, §12) | Task 6 |
| Motion config validated (zod), persisted via `setMotionConfig` (§9) | Task 6 |
| Theme selected per event via `setTheme` (§10) | Task 6 |
| QR from `PUBLIC_BASE_URL` + code → PNG (§11, contracts `GET :id/qr`) | Task 7 |
| Theme builder CRUD; presets cannot be deleted → 409 (§10, contracts) | Task 8 |
| Global settings: `publicBaseUrl`, media limits, change password (§11, §13, §15) | Task 9 |
| Public `GET /api/events/by-code/:code` → `PublicEvent` (joins theme + motion) (§5, contracts) | Task 10 |
| Public photos read (empty until Plan 3) | Task 10 |
| All admin routers behind `requireAuth`; full lifecycle integration | Task 11 |
| `initRealtime(httpServer)` wired in entry (§4, contracts) | Task 11 (`index.ts`) |

**Deferred to later plans (not in scope):** media upload/processing, `photo:added/hidden/deleted` emission, `adminPhotos`/`adminExport`/`media` routes, export zip (Plan 3); all React/web surfaces (Plans 4–6); rotation engine (Plan 6).
