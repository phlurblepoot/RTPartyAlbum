# RTPartyAlbum — Plan 1: Foundation & Data Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the RTPartyAlbum monorepo with a working, tested SQLite data layer and a running Express server. After this plan you can `npm install`, run all workspace tests green, start the server, and hit `GET /api/health`. No media processing, auth, realtime, or front-end yet — those are later plans. This plan builds the foundation every later plan imports from.

**Architecture:** npm-workspaces monorepo (`shared`, `server`, `web`). `@rtpa/shared` holds the canonical TypeScript types + constants. `@rtpa/server` is an ESM Express app built by a `buildApp(deps)` factory (no `listen` inside, so it is supertest-able), backed by `better-sqlite3` with a small idempotent migration runner, theme-preset seeding, and four typed repositories (settings/theme/event/photo). `web` is an empty placeholder so workspaces resolve. A multi-stage Dockerfile + compose file package the whole thing as one image for Unraid.

**Tech Stack:** Node 20, TypeScript ^5.4, ESM (`"type": "module"`) everywhere. Server: Express ^4.19, better-sqlite3 ^11, nanoid ^5, zod ^3.23 (plus deps reserved for later plans: socket.io ^4.7, multer ^1.4.5-lts.1, sharp ^0.33, fluent-ffmpeg ^2.1.3, ffmpeg-static ^5.2, bcryptjs ^2.4, jsonwebtoken ^9, cookie-parser ^1.4, express-rate-limit ^7, qrcode ^1.5, archiver ^7). Tests: Vitest ^2, supertest ^7, run TS via `tsx`.

---

### Task 1 — Monorepo scaffold

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/package.json`
- Create: `/home/nathan/claude/RTPartyAlbum/tsconfig.base.json`
- Create: `/home/nathan/claude/RTPartyAlbum/web/package.json` (empty placeholder so workspaces resolve)
- Create: `/home/nathan/claude/RTPartyAlbum/.gitignore` (append node_modules / build / runtime dirs if not already ignored)

Steps:

- [ ] Inspect the existing `.gitignore` so we don't duplicate entries:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && cat .gitignore
  ```

- [ ] Ensure `.gitignore` contains these lines (add any that are missing; do not remove existing lines). Final desired content:

  ```gitignore
  node_modules/
  dist/
  *.tsbuildinfo
  .data/
  .uploads/
  *.db
  *.db-shm
  *.db-wal
  .DS_Store
  ```

- [ ] Create the root `package.json` at `/home/nathan/claude/RTPartyAlbum/package.json`:

  ```json
  {
    "name": "rtpartyalbum",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "workspaces": [
      "shared",
      "server",
      "web"
    ],
    "scripts": {
      "build": "npm run build -w @rtpa/shared && npm run build -w @rtpa/server",
      "test": "npm test --workspaces --if-present",
      "dev:server": "npm run dev -w @rtpa/server"
    },
    "engines": {
      "node": ">=20"
    }
  }
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/tsconfig.base.json`:

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["ES2022"],
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "strict": true,
      "esModuleInterop": true,
      "forceConsistentCasingInFileNames": true,
      "skipLibCheck": true,
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "noUncheckedIndexedAccess": true,
      "noImplicitOverride": true
    }
  }
  ```

- [ ] Create the placeholder web package at `/home/nathan/claude/RTPartyAlbum/web/package.json` so the `web` workspace resolves (real web app comes in later plans):

  ```json
  {
    "name": "@rtpa/web",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "build": "echo \"web build placeholder (implemented in Plan 4+)\"",
      "test": "echo \"web tests placeholder (implemented in Plan 4+)\""
    }
  }
  ```

- [ ] Verify the workspace install resolves with the three packages:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm install
  ```

  Expected: install completes with no errors; output mentions `added N packages` and lists no `EUNSUPPORTEDPROTOCOL`/workspace-resolution errors. (At this point `shared` and `server` don't exist yet, so `npm install` only resolves `web` plus root — that is fine; we re-run install as each package is added.)

- [ ] Commit:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && git add package.json tsconfig.base.json web/package.json .gitignore && git commit -m "chore: scaffold npm-workspaces monorepo (shared/server/web)"
  ```

---

### Task 2 — `@rtpa/shared` package (types + constants)

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/shared/package.json`
- Create: `/home/nathan/claude/RTPartyAlbum/shared/tsconfig.json`
- Create: `/home/nathan/claude/RTPartyAlbum/shared/src/types.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/shared/src/constants.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/shared/src/index.ts`
- Test: `/home/nathan/claude/RTPartyAlbum/shared/src/__tests__/constants.test.ts`

Steps:

- [ ] Create `/home/nathan/claude/RTPartyAlbum/shared/package.json`:

  ```json
  {
    "name": "@rtpa/shared",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    },
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "test": "vitest run"
    },
    "devDependencies": {
      "typescript": "^5.4.0",
      "vitest": "^2.0.0"
    }
  }
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/shared/tsconfig.json`:

  ```json
  {
    "extends": "../tsconfig.base.json",
    "compilerOptions": {
      "rootDir": "./src",
      "outDir": "./dist"
    },
    "include": ["src/**/*"],
    "exclude": ["src/**/__tests__/**", "dist", "node_modules"]
  }
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/shared/src/types.ts` (VERBATIM from contracts):

  ```ts
  export type MediaType = 'image' | 'video';
  export type EventStatus = 'active' | 'paused' | 'ended';

  export type MotionStyle = 'drift' | 'current' | 'orbit' | 'mosaic';
  export type EnterAnimation = 'flyInEdge' | 'scalePop' | 'fadeGrow' | 'spinIn' | 'dropBounce';
  export type LeaveAnimation = 'driftOffEdge' | 'shrinkFade' | 'spinOut' | 'slideAway';

  export interface MotionConfig {
    motionWeights: Record<MotionStyle, number>;
    speed: number;            // multiplier 0.25..3
    maxOnCanvas: number;      // hard cap
    dwell: { enabled: boolean; durationMs: number; varianceMs: number };
    enterWeights: Record<EnterAnimation, number>;
    leaveWeights: Record<LeaveAnimation, number>;
    baseSize: number;         // px, tile longest edge baseline
    sizeVariance: number;     // 0..1
  }

  export interface ThemeTokens {
    background: { type: 'solid' | 'gradient' | 'image'; value: string };
    ambient: 'none' | 'bokeh' | 'particles' | 'glow';
    frame: {
      style: 'thin' | 'polaroid' | 'rounded' | 'none';
      borderColor: string;
      borderWidth: number;
      radius: number;
      shadow: boolean;
    };
    caption: { enabled: boolean; bg: string; color: string };
    font: string;
    accent: string;
  }

  export interface Theme {
    id: string;
    name: string;
    isPreset: boolean;
    tokens: ThemeTokens;
  }

  export interface MediaLimits {
    photoMaxBytes: number;
    videoMaxBytes: number;
    videoMaxDurationSec: number;
  }

  export interface EventSummary {
    id: string;
    code: string;
    name: string;
    createdAt: string;       // ISO 8601
    isActive: boolean;
    uploadEnabled: boolean;
    status: EventStatus;
    themeId: string;
    photoCount: number;
  }

  export interface EventDetail extends EventSummary {
    motionConfig: MotionConfig;
  }

  // Public event view for upload + display pages
  export interface PublicEvent {
    code: string;
    name: string;
    status: EventStatus;
    uploadEnabled: boolean;
    theme: Theme;
    motionConfig: MotionConfig;
  }

  export interface Photo {
    id: string;
    eventId: string;
    uploaderName: string;
    mediaType: MediaType;
    width: number;
    height: number;
    durationMs: number | null;
    createdAt: string;       // ISO 8601
    isHidden: boolean;
    displayUrl: string;      // image jpeg OR processed mp4
    thumbUrl: string;        // jpeg poster/thumbnail
  }

  export interface PhotoAdmin extends Photo {
    deviceId: string;
    userAgent: string;
    ipAddress: string;
  }

  export interface ServerToClientEvents {
    'photo:added': (photo: Photo) => void;
    'photo:hidden': (payload: { id: string }) => void;
    'photo:deleted': (payload: { id: string }) => void;
    'settings:updated': (motionConfig: MotionConfig) => void;
    'theme:updated': (theme: Theme) => void;
  }

  export interface ClientToServerEvents {
    join: (eventCode: string) => void;
  }
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/shared/src/constants.ts` (VERBATIM from contracts):

  ```ts
  import type { MotionConfig, MediaLimits } from './types.js';

  export const DEFAULT_MOTION_CONFIG: MotionConfig = {
    motionWeights: { drift: 5, current: 2, orbit: 1, mosaic: 2 },
    speed: 1,
    maxOnCanvas: 24,
    dwell: { enabled: true, durationMs: 45000, varianceMs: 15000 },
    enterWeights: { flyInEdge: 3, scalePop: 2, fadeGrow: 2, spinIn: 1, dropBounce: 2 },
    leaveWeights: { driftOffEdge: 3, shrinkFade: 3, spinOut: 1, slideAway: 2 },
    baseSize: 220,
    sizeVariance: 0.4,
  };

  export const DEFAULT_MEDIA_LIMITS: MediaLimits = {
    photoMaxBytes: 25 * 1024 * 1024,
    videoMaxBytes: 60 * 1024 * 1024,
    videoMaxDurationSec: 30,
  };

  export const DEFAULT_THEME_ID = 'preset-midnight-gala';
  export const SETTINGS_KEYS = {
    publicBaseUrl: 'public_base_url',
    adminPasswordHash: 'admin_password_hash',
    mediaLimits: 'media_limits',
    sessionSecret: 'session_secret',
  } as const;
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/shared/src/index.ts`:

  ```ts
  export * from './types.js';
  export * from './constants.js';
  ```

- [ ] Write the failing test at `/home/nathan/claude/RTPartyAlbum/shared/src/__tests__/constants.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    DEFAULT_MOTION_CONFIG,
    DEFAULT_MEDIA_LIMITS,
    DEFAULT_THEME_ID,
    SETTINGS_KEYS,
  } from '../index.js';

  describe('DEFAULT_MOTION_CONFIG', () => {
    it('has all four motion weights as positive numbers', () => {
      const w = DEFAULT_MOTION_CONFIG.motionWeights;
      expect(Object.keys(w).sort()).toEqual(['current', 'drift', 'mosaic', 'orbit']);
      for (const v of Object.values(w)) {
        expect(typeof v).toBe('number');
        expect(v).toBeGreaterThan(0);
      }
    });

    it('weights sum to the expected total (5+2+1+2 = 10)', () => {
      const sum = Object.values(DEFAULT_MOTION_CONFIG.motionWeights).reduce((a, b) => a + b, 0);
      expect(sum).toBe(10);
    });

    it('has all five enter-animation weights', () => {
      expect(Object.keys(DEFAULT_MOTION_CONFIG.enterWeights).sort()).toEqual(
        ['dropBounce', 'fadeGrow', 'flyInEdge', 'scalePop', 'spinIn'],
      );
    });

    it('has all four leave-animation weights', () => {
      expect(Object.keys(DEFAULT_MOTION_CONFIG.leaveWeights).sort()).toEqual(
        ['driftOffEdge', 'shrinkFade', 'slideAway', 'spinOut'],
      );
    });

    it('has sensible scalar defaults', () => {
      expect(DEFAULT_MOTION_CONFIG.speed).toBe(1);
      expect(DEFAULT_MOTION_CONFIG.maxOnCanvas).toBe(24);
      expect(DEFAULT_MOTION_CONFIG.baseSize).toBe(220);
      expect(DEFAULT_MOTION_CONFIG.sizeVariance).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_MOTION_CONFIG.sizeVariance).toBeLessThanOrEqual(1);
    });

    it('has dwell enabled by default with duration and variance', () => {
      expect(DEFAULT_MOTION_CONFIG.dwell.enabled).toBe(true);
      expect(DEFAULT_MOTION_CONFIG.dwell.durationMs).toBe(45000);
      expect(DEFAULT_MOTION_CONFIG.dwell.varianceMs).toBe(15000);
    });
  });

  describe('DEFAULT_MEDIA_LIMITS', () => {
    it('matches the documented caps', () => {
      expect(DEFAULT_MEDIA_LIMITS.photoMaxBytes).toBe(25 * 1024 * 1024);
      expect(DEFAULT_MEDIA_LIMITS.videoMaxBytes).toBe(60 * 1024 * 1024);
      expect(DEFAULT_MEDIA_LIMITS.videoMaxDurationSec).toBe(30);
    });
  });

  describe('constants', () => {
    it('default theme id is midnight gala', () => {
      expect(DEFAULT_THEME_ID).toBe('preset-midnight-gala');
    });

    it('settings keys are snake_case strings', () => {
      expect(SETTINGS_KEYS.publicBaseUrl).toBe('public_base_url');
      expect(SETTINGS_KEYS.adminPasswordHash).toBe('admin_password_hash');
      expect(SETTINGS_KEYS.mediaLimits).toBe('media_limits');
      expect(SETTINGS_KEYS.sessionSecret).toBe('session_secret');
    });
  });
  ```

- [ ] Install so the new package's dev deps resolve:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm install
  ```

  Expected: install succeeds and resolves `typescript` + `vitest` for `@rtpa/shared`.

- [ ] Run the test and confirm it PASSES (the code is already written, so this is a green run — there is no separate implementation step because types/constants ARE the deliverable):

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/shared
  ```

  Expected: `Test Files  1 passed (1)` and all individual `constants.test.ts` assertions pass.

- [ ] Confirm the package type-checks / builds:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm run build -w @rtpa/shared
  ```

  Expected: exits 0, produces `shared/dist/index.js` and `shared/dist/index.d.ts`.

- [ ] Commit:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && git add shared && git commit -m "feat(shared): add canonical types and constants with tests"
  ```

---

### Task 3 — `@rtpa/server` package scaffold + config

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/server/package.json`
- Create: `/home/nathan/claude/RTPartyAlbum/server/tsconfig.json`
- Create: `/home/nathan/claude/RTPartyAlbum/server/vitest.config.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/config.ts`
- Test: `/home/nathan/claude/RTPartyAlbum/server/src/__tests__/config.test.ts`

Steps:

- [ ] Create `/home/nathan/claude/RTPartyAlbum/server/package.json` (all server deps + dev deps from contracts; later-plan deps included now so `npm install` is done once):

  ```json
  {
    "name": "@rtpa/server",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "dev": "tsx watch src/index.ts",
      "start": "node dist/index.js",
      "test": "vitest run"
    },
    "dependencies": {
      "@rtpa/shared": "*",
      "archiver": "^7.0.0",
      "bcryptjs": "^2.4.3",
      "better-sqlite3": "^11.0.0",
      "cookie-parser": "^1.4.6",
      "express": "^4.19.0",
      "express-rate-limit": "^7.0.0",
      "ffmpeg-static": "^5.2.0",
      "fluent-ffmpeg": "^2.1.3",
      "jsonwebtoken": "^9.0.0",
      "multer": "^1.4.5-lts.1",
      "nanoid": "^5.0.0",
      "qrcode": "^1.5.0",
      "sharp": "^0.33.0",
      "socket.io": "^4.7.0",
      "zod": "^3.23.0"
    },
    "devDependencies": {
      "@types/archiver": "^6.0.0",
      "@types/better-sqlite3": "^7.6.0",
      "@types/cookie-parser": "^1.4.0",
      "@types/express": "^4.17.0",
      "@types/fluent-ffmpeg": "^2.1.0",
      "@types/jsonwebtoken": "^9.0.0",
      "@types/multer": "^1.4.0",
      "@types/node": "^20.0.0",
      "@types/qrcode": "^1.5.0",
      "@types/supertest": "^6.0.0",
      "supertest": "^7.0.0",
      "tsx": "^4.7.0",
      "typescript": "^5.4.0",
      "vitest": "^2.0.0"
    }
  }
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/server/tsconfig.json`:

  ```json
  {
    "extends": "../tsconfig.base.json",
    "compilerOptions": {
      "rootDir": "./src",
      "outDir": "./dist",
      "types": ["node"]
    },
    "include": ["src/**/*"],
    "exclude": ["src/**/__tests__/**", "dist", "node_modules"]
  }
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/server/vitest.config.ts`:

  ```ts
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      globals: false,
    },
  });
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/server/src/config.ts` (env + NODE_ENV-aware defaults + overrides):

  ```ts
  export interface Config {
    port: number;                       // PORT, default 8080
    dataDir: string;                    // DATA_DIR, default '/data' (dev: './.data')
    uploadsDir: string;                 // UPLOADS_DIR, default '/uploads' (dev: './.uploads')
    adminPassword: string | undefined;  // ADMIN_PASSWORD (bootstrap)
    publicBaseUrl: string;              // PUBLIC_BASE_URL, default ''
    sessionSecret: string;              // SESSION_SECRET; '' means "generate & store later"
    nodeEnv: string;                    // NODE_ENV
  }

  function parsePort(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || n > 65535) {
      throw new Error(`Invalid PORT value: "${raw}"`);
    }
    return n;
  }

  export function loadConfig(overrides: Partial<Config> = {}): Config {
    const env = process.env;
    const nodeEnv = overrides.nodeEnv ?? env.NODE_ENV ?? 'development';
    const isProd = nodeEnv === 'production';

    const base: Config = {
      port: parsePort(env.PORT, 8080),
      dataDir: env.DATA_DIR ?? (isProd ? '/data' : './.data'),
      uploadsDir: env.UPLOADS_DIR ?? (isProd ? '/uploads' : './.uploads'),
      adminPassword: env.ADMIN_PASSWORD,
      publicBaseUrl: env.PUBLIC_BASE_URL ?? '',
      sessionSecret: env.SESSION_SECRET ?? '',
      nodeEnv,
    };

    return { ...base, ...overrides };
  }
  ```

- [ ] Write the failing test at `/home/nathan/claude/RTPartyAlbum/server/src/__tests__/config.test.ts`:

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { loadConfig } from '../config.js';

  const ENV_KEYS = [
    'PORT', 'DATA_DIR', 'UPLOADS_DIR', 'ADMIN_PASSWORD',
    'PUBLIC_BASE_URL', 'SESSION_SECRET', 'NODE_ENV',
  ] as const;

  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('loadConfig', () => {
    it('uses development defaults when NODE_ENV is unset', () => {
      const c = loadConfig();
      expect(c.port).toBe(8080);
      expect(c.dataDir).toBe('./.data');
      expect(c.uploadsDir).toBe('./.uploads');
      expect(c.publicBaseUrl).toBe('');
      expect(c.sessionSecret).toBe('');
      expect(c.adminPassword).toBeUndefined();
      expect(c.nodeEnv).toBe('development');
    });

    it('uses production volume paths when NODE_ENV=production', () => {
      process.env.NODE_ENV = 'production';
      const c = loadConfig();
      expect(c.dataDir).toBe('/data');
      expect(c.uploadsDir).toBe('/uploads');
      expect(c.nodeEnv).toBe('production');
    });

    it('reads values from environment variables', () => {
      process.env.PORT = '9000';
      process.env.DATA_DIR = '/custom/data';
      process.env.UPLOADS_DIR = '/custom/uploads';
      process.env.ADMIN_PASSWORD = 'hunter2';
      process.env.PUBLIC_BASE_URL = 'https://party.example.com';
      process.env.SESSION_SECRET = 's3cret';
      const c = loadConfig();
      expect(c.port).toBe(9000);
      expect(c.dataDir).toBe('/custom/data');
      expect(c.uploadsDir).toBe('/custom/uploads');
      expect(c.adminPassword).toBe('hunter2');
      expect(c.publicBaseUrl).toBe('https://party.example.com');
      expect(c.sessionSecret).toBe('s3cret');
    });

    it('applies overrides on top of env', () => {
      process.env.PORT = '9000';
      const c = loadConfig({ port: 1234, dataDir: '/override' });
      expect(c.port).toBe(1234);
      expect(c.dataDir).toBe('/override');
    });

    it('throws on an invalid PORT', () => {
      process.env.PORT = 'not-a-number';
      expect(() => loadConfig()).toThrow(/Invalid PORT/);
    });

    it('nodeEnv override changes dir defaults', () => {
      const c = loadConfig({ nodeEnv: 'production' });
      expect(c.dataDir).toBe('/data');
      expect(c.uploadsDir).toBe('/uploads');
    });
  });
  ```

- [ ] Install so server deps (better-sqlite3, express, tsx, vitest, types, etc.) are available:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm install
  ```

  Expected: completes 0; `better-sqlite3` and `sharp` native builds succeed (Node 20). If a native build fails, ensure build tools are present, then re-run.

- [ ] Run the config test and confirm PASS:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/__tests__/config.test.ts
  ```

  Expected: `Test Files  1 passed (1)`, 6 tests pass.

- [ ] Commit:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && git add server && git commit -m "feat(server): scaffold server package and env-aware config loader"
  ```

---

### Task 4 — DB connection module

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/db/connection.ts`
- Test: `/home/nathan/claude/RTPartyAlbum/server/src/db/__tests__/connection.test.ts`

Steps:

- [ ] Write the failing test at `/home/nathan/claude/RTPartyAlbum/server/src/db/__tests__/connection.test.ts`:

  ```ts
  import { describe, it, expect, afterEach } from 'vitest';
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { openDb, openMemoryDb } from '../connection.js';

  const tmpDirs: string[] = [];

  function makeTmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'rtpa-conn-'));
    tmpDirs.push(d);
    return d;
  }

  afterEach(() => {
    while (tmpDirs.length) {
      const d = tmpDirs.pop()!;
      rmSync(d, { recursive: true, force: true });
    }
  });

  describe('openDb', () => {
    it('opens a file db with WAL journaling and foreign keys ON', () => {
      const dir = makeTmp();
      const db = openDb(join(dir, 'test.db'));
      const journal = db.pragma('journal_mode', { simple: true });
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(String(journal).toLowerCase()).toBe('wal');
      expect(Number(fk)).toBe(1);
      db.close();
    });

    it('can create and read a table (sanity)', () => {
      const dir = makeTmp();
      const db = openDb(join(dir, 'test.db'));
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
      db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
      const row = db.prepare('SELECT v FROM t WHERE id = 1').get() as { v: string };
      expect(row.v).toBe('hello');
      db.close();
    });
  });

  describe('openMemoryDb', () => {
    it('opens an in-memory db with foreign keys ON', () => {
      const db = openMemoryDb();
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(Number(fk)).toBe(1);
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      db.prepare('INSERT INTO t (id) VALUES (1)').run();
      const count = db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number };
      expect(count.n).toBe(1);
      db.close();
    });
  });
  ```

- [ ] Run it and confirm it FAILS (module does not exist yet):

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/__tests__/connection.test.ts
  ```

  Expected: FAIL — `Failed to resolve import "../connection.js"` / "Cannot find module".

- [ ] Implement `/home/nathan/claude/RTPartyAlbum/server/src/db/connection.ts`:

  ```ts
  import Database from 'better-sqlite3';
  import { mkdirSync } from 'node:fs';
  import { dirname } from 'node:path';

  export type Db = Database.Database;

  function applyPragmas(db: Db): void {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }

  /** Open (creating parent dirs as needed) a persistent SQLite db with WAL + FKs. */
  export function openDb(path: string): Db {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    applyPragmas(db);
    return db;
  }

  /** Open an ephemeral in-memory SQLite db (tests). FKs on; WAL is a no-op for :memory:. */
  export function openMemoryDb(): Db {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    return db;
  }
  ```

- [ ] Run the test and confirm PASS:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/__tests__/connection.test.ts
  ```

  Expected: `Test Files  1 passed (1)`, 4 tests pass.

- [ ] Commit:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && git add server/src/db && git commit -m "feat(server): add sqlite connection module (WAL + foreign keys)"
  ```

---

### Task 5 — Migration runner + initial schema

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/db/migrations/001_init.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/db/migrate.ts`
- Test: `/home/nathan/claude/RTPartyAlbum/server/src/db/__tests__/migrate.test.ts`

Steps:

- [ ] Write the failing test at `/home/nathan/claude/RTPartyAlbum/server/src/db/__tests__/migrate.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { openMemoryDb } from '../connection.js';
  import { migrate } from '../migrate.js';

  function tableNames(db: ReturnType<typeof openMemoryDb>): string[] {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map((r) => r.name)
      .sort();
  }

  function indexNames(db: ReturnType<typeof openMemoryDb>): string[] {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
      .map((r) => r.name)
      .sort();
  }

  describe('migrate', () => {
    it('creates all tables and the photos index', () => {
      const db = openMemoryDb();
      migrate(db);
      const tables = tableNames(db);
      expect(tables).toContain('settings');
      expect(tables).toContain('themes');
      expect(tables).toContain('events');
      expect(tables).toContain('photos');
      expect(tables).toContain('migrations');
      expect(indexNames(db)).toContain('idx_photos_event_created');
      db.close();
    });

    it('is idempotent — running twice is safe and records one applied migration', () => {
      const db = openMemoryDb();
      migrate(db);
      migrate(db);
      const applied = db.prepare('SELECT id FROM migrations ORDER BY id').all() as { id: string }[];
      expect(applied.map((r) => r.id)).toEqual(['001_init']);
      // tables still intact
      expect(tableNames(db)).toContain('photos');
      db.close();
    });

    it('enforces the theme_id foreign key on events', () => {
      const db = openMemoryDb();
      migrate(db);
      const insert = () =>
        db.prepare(
          `INSERT INTO events (id, code, name, created_at, theme_id, motion_config)
           VALUES ('e1', 'abc', 'Party', '2026-06-02T00:00:00.000Z', 'missing-theme', '{}')`,
        ).run();
      expect(insert).toThrow();
      db.close();
    });
  });
  ```

- [ ] Run it and confirm FAIL (modules missing):

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/__tests__/migrate.test.ts
  ```

  Expected: FAIL — cannot resolve `../migrate.js`.

- [ ] Create `/home/nathan/claude/RTPartyAlbum/server/src/db/migrations/001_init.ts` (schema VERBATIM from contracts):

  ```ts
  import type { Db } from '../connection.js';

  export const id = '001_init';

  export function up(db: Db): void {
    db.exec(`
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE themes (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        is_preset INTEGER NOT NULL DEFAULT 0,
        tokens    TEXT NOT NULL
      );

      CREATE TABLE events (
        id             TEXT PRIMARY KEY,
        code           TEXT NOT NULL UNIQUE,
        name           TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        is_active      INTEGER NOT NULL DEFAULT 0,
        upload_enabled INTEGER NOT NULL DEFAULT 1,
        status         TEXT NOT NULL DEFAULT 'active',
        theme_id       TEXT NOT NULL,
        motion_config  TEXT NOT NULL,
        FOREIGN KEY (theme_id) REFERENCES themes(id)
      );

      CREATE TABLE photos (
        id           TEXT PRIMARY KEY,
        event_id     TEXT NOT NULL,
        uploader_name TEXT NOT NULL,
        file_path    TEXT NOT NULL,
        display_path TEXT NOT NULL,
        thumb_path   TEXT NOT NULL,
        media_type   TEXT NOT NULL,
        width        INTEGER NOT NULL,
        height       INTEGER NOT NULL,
        duration_ms  INTEGER,
        created_at   TEXT NOT NULL,
        is_hidden    INTEGER NOT NULL DEFAULT 0,
        device_id    TEXT NOT NULL,
        user_agent   TEXT NOT NULL,
        ip_address   TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES events(id)
      );

      CREATE INDEX idx_photos_event_created ON photos(event_id, created_at DESC);
    `);
  }
  ```

- [ ] Implement the runner `/home/nathan/claude/RTPartyAlbum/server/src/db/migrate.ts`:

  ```ts
  import type { Db } from './connection.js';
  import * as init001 from './migrations/001_init.js';

  interface Migration {
    id: string;
    up: (db: Db) => void;
  }

  const MIGRATIONS: Migration[] = [
    { id: init001.id, up: init001.up },
  ];

  function ensureMigrationsTable(db: Db): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id         TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
  }

  /** Apply all not-yet-applied migrations. Safe to call repeatedly (idempotent). */
  export function migrate(db: Db): void {
    ensureMigrationsTable(db);
    const appliedRows = db.prepare('SELECT id FROM migrations').all() as { id: string }[];
    const applied = new Set(appliedRows.map((r) => r.id));
    const record = db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)');

    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      const run = db.transaction(() => {
        m.up(db);
        record.run(m.id, new Date().toISOString());
      });
      run();
    }
  }
  ```

- [ ] Run the migrate test and confirm PASS:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/__tests__/migrate.test.ts
  ```

  Expected: `Test Files  1 passed (1)`, 3 tests pass.

- [ ] Commit:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && git add server/src/db && git commit -m "feat(server): add idempotent migration runner and 001 schema"
  ```

---

### Task 6 — Theme presets + seeding

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/db/presets.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/db/seed.ts`
- Test: `/home/nathan/claude/RTPartyAlbum/server/src/db/__tests__/seed.test.ts`

> NOTE: This task uses `themeRepo.upsertPreset` and `settingsRepo` from Task 7. To keep TDD honest, implement the four repositories (Task 7) before running the seed test, OR run them interleaved. The seed module below depends only on `themeRepo.upsertPreset`, `themeRepo.getById`, and `settingsRepo.get/set/setJson`, all defined in Task 7. The plan orders Task 7 immediately after this task's code is written; run the seed test at the end of Task 7.

Steps:

- [ ] Create `/home/nathan/claude/RTPartyAlbum/server/src/db/presets.ts` with all 9 preset `Theme` objects (stable ids exactly as in contracts; full realistic `ThemeTokens`):

  ```ts
  import type { Theme } from '@rtpa/shared';

  export const PRESET_THEMES: Theme[] = [
    {
      id: 'preset-midnight-gala',
      name: 'Midnight Gala',
      isPreset: true,
      tokens: {
        background: { type: 'gradient', value: 'linear-gradient(135deg, #0b1026 0%, #1c2240 60%, #2a1a3e 100%)' },
        ambient: 'glow',
        frame: { style: 'thin', borderColor: '#d4af37', borderWidth: 2, radius: 10, shadow: true },
        caption: { enabled: true, bg: 'rgba(10,12,30,0.72)', color: '#f5e9c8' },
        font: "'Playfair Display', Georgia, serif",
        accent: '#d4af37',
      },
    },
    {
      id: 'preset-warm-bokeh',
      name: 'Warm Bokeh',
      isPreset: true,
      tokens: {
        background: { type: 'gradient', value: 'radial-gradient(circle at 30% 20%, #4a2c12 0%, #2a1808 70%, #160c04 100%)' },
        ambient: 'bokeh',
        frame: { style: 'rounded', borderColor: '#ffcc88', borderWidth: 3, radius: 18, shadow: true },
        caption: { enabled: true, bg: 'rgba(40,22,8,0.7)', color: '#ffe6c2' },
        font: "'Quicksand', 'Segoe UI', sans-serif",
        accent: '#ffae57',
      },
    },
    {
      id: 'preset-neon-night',
      name: 'Neon Night',
      isPreset: true,
      tokens: {
        background: { type: 'solid', value: '#05010f' },
        ambient: 'particles',
        frame: { style: 'thin', borderColor: '#ff2bd6', borderWidth: 2, radius: 6, shadow: true },
        caption: { enabled: true, bg: 'rgba(20,0,40,0.8)', color: '#5cf6ff' },
        font: "'Orbitron', 'Segoe UI', sans-serif",
        accent: '#ff2bd6',
      },
    },
    {
      id: 'preset-clean-light',
      name: 'Clean Light',
      isPreset: true,
      tokens: {
        background: { type: 'solid', value: '#f7f7f5' },
        ambient: 'none',
        frame: { style: 'rounded', borderColor: '#e2e2dc', borderWidth: 1, radius: 12, shadow: true },
        caption: { enabled: true, bg: 'rgba(255,255,255,0.9)', color: '#2b2b2b' },
        font: "'Inter', 'Helvetica Neue', sans-serif",
        accent: '#3b82f6',
      },
    },
    {
      id: 'preset-rustic-kraft',
      name: 'Rustic Kraft',
      isPreset: true,
      tokens: {
        background: { type: 'solid', value: '#c8a877' },
        ambient: 'none',
        frame: { style: 'polaroid', borderColor: '#fdf8ee', borderWidth: 12, radius: 4, shadow: true },
        caption: { enabled: true, bg: 'rgba(60,42,20,0.78)', color: '#f3e4c4' },
        font: "'Caveat', 'Comic Sans MS', cursive",
        accent: '#8a5a2b',
      },
    },
    {
      id: 'preset-garden-pastel',
      name: 'Garden Pastel',
      isPreset: true,
      tokens: {
        background: { type: 'gradient', value: 'linear-gradient(160deg, #e9f7ec 0%, #f3e9f7 50%, #e9f0f7 100%)' },
        ambient: 'bokeh',
        frame: { style: 'rounded', borderColor: '#ffffff', borderWidth: 4, radius: 20, shadow: true },
        caption: { enabled: true, bg: 'rgba(255,255,255,0.85)', color: '#4a5a4f' },
        font: "'Nunito', 'Segoe UI', sans-serif",
        accent: '#7bc4a4',
      },
    },
    {
      id: 'preset-monochrome-film',
      name: 'Monochrome Film',
      isPreset: true,
      tokens: {
        background: { type: 'solid', value: '#141414' },
        ambient: 'none',
        frame: { style: 'thin', borderColor: '#e8e8e8', borderWidth: 2, radius: 0, shadow: false },
        caption: { enabled: true, bg: 'rgba(0,0,0,0.8)', color: '#eaeaea' },
        font: "'Courier New', monospace",
        accent: '#bdbdbd',
      },
    },
    {
      id: 'preset-confetti-pop',
      name: 'Confetti Pop',
      isPreset: true,
      tokens: {
        background: { type: 'gradient', value: 'linear-gradient(135deg, #ff5e7e 0%, #ffb347 50%, #57e0ff 100%)' },
        ambient: 'particles',
        frame: { style: 'rounded', borderColor: '#ffffff', borderWidth: 5, radius: 16, shadow: true },
        caption: { enabled: true, bg: 'rgba(40,20,60,0.7)', color: '#ffffff' },
        font: "'Baloo 2', 'Segoe UI', sans-serif",
        accent: '#ff3d77',
      },
    },
    {
      id: 'preset-starfield',
      name: 'Starfield',
      isPreset: true,
      tokens: {
        background: { type: 'gradient', value: 'radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%)' },
        ambient: 'particles',
        frame: { style: 'thin', borderColor: '#9fb3d1', borderWidth: 1, radius: 8, shadow: true },
        caption: { enabled: true, bg: 'rgba(9,10,15,0.78)', color: '#cfe0ff' },
        font: "'Exo 2', 'Segoe UI', sans-serif",
        accent: '#6ea8ff',
      },
    },
  ];
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/server/src/db/seed.ts` (idempotent preset + settings seeding). It takes already-constructed repos so it stays testable:

  ```ts
  import { randomBytes } from 'node:crypto';
  import {
    DEFAULT_MEDIA_LIMITS,
    SETTINGS_KEYS,
    DEFAULT_THEME_ID,
    type MediaLimits,
  } from '@rtpa/shared';
  import { PRESET_THEMES } from './presets.js';
  import type { ThemeRepo } from './repositories/themeRepo.js';
  import type { SettingsRepo } from './repositories/settingsRepo.js';

  export interface SeedDeps {
    themeRepo: ThemeRepo;
    settingsRepo: SettingsRepo;
  }

  /** Seed preset themes and default settings. Safe to run on every boot (idempotent). */
  export function seed(deps: SeedDeps): void {
    const { themeRepo, settingsRepo } = deps;

    for (const theme of PRESET_THEMES) {
      themeRepo.upsertPreset(theme);
    }

    if (settingsRepo.get(SETTINGS_KEYS.mediaLimits) === undefined) {
      settingsRepo.setJson(SETTINGS_KEYS.mediaLimits, DEFAULT_MEDIA_LIMITS satisfies MediaLimits);
    }

    if (settingsRepo.get(SETTINGS_KEYS.publicBaseUrl) === undefined) {
      settingsRepo.set(SETTINGS_KEYS.publicBaseUrl, '');
    }

    if (settingsRepo.get(SETTINGS_KEYS.sessionSecret) === undefined) {
      settingsRepo.set(SETTINGS_KEYS.sessionSecret, randomBytes(32).toString('hex'));
    }
  }

  export { DEFAULT_THEME_ID };
  ```

- [ ] Write the (initially failing — repos not yet built) seed test at `/home/nathan/claude/RTPartyAlbum/server/src/db/__tests__/seed.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { DEFAULT_THEME_ID, SETTINGS_KEYS, type MediaLimits } from '@rtpa/shared';
  import { openMemoryDb } from '../connection.js';
  import { migrate } from '../migrate.js';
  import { makeThemeRepo } from '../repositories/themeRepo.js';
  import { makeSettingsRepo } from '../repositories/settingsRepo.js';
  import { seed } from '../seed.js';
  import { PRESET_THEMES } from '../presets.js';

  function freshSeededDb() {
    const db = openMemoryDb();
    migrate(db);
    const themeRepo = makeThemeRepo(db);
    const settingsRepo = makeSettingsRepo(db);
    return { db, themeRepo, settingsRepo };
  }

  describe('seed', () => {
    it('inserts all 9 presets including the default theme', () => {
      const { db, themeRepo, settingsRepo } = freshSeededDb();
      seed({ themeRepo, settingsRepo });
      const themes = themeRepo.list();
      expect(themes).toHaveLength(9);
      expect(themeRepo.getById(DEFAULT_THEME_ID)).toBeDefined();
      for (const p of PRESET_THEMES) {
        expect(themeRepo.getById(p.id)?.isPreset).toBe(true);
      }
      db.close();
    });

    it('seeds default media limits and an empty public base url', () => {
      const { db, themeRepo, settingsRepo } = freshSeededDb();
      seed({ themeRepo, settingsRepo });
      const limits = settingsRepo.getJson<MediaLimits>(SETTINGS_KEYS.mediaLimits);
      expect(limits?.photoMaxBytes).toBe(25 * 1024 * 1024);
      expect(settingsRepo.get(SETTINGS_KEYS.publicBaseUrl)).toBe('');
      db.close();
    });

    it('generates and stores a session secret when absent', () => {
      const { db, themeRepo, settingsRepo } = freshSeededDb();
      seed({ themeRepo, settingsRepo });
      const secret = settingsRepo.get(SETTINGS_KEYS.sessionSecret);
      expect(typeof secret).toBe('string');
      expect((secret ?? '').length).toBeGreaterThanOrEqual(32);
      db.close();
    });

    it('is idempotent and does not regenerate the session secret', () => {
      const { db, themeRepo, settingsRepo } = freshSeededDb();
      seed({ themeRepo, settingsRepo });
      const firstSecret = settingsRepo.get(SETTINGS_KEYS.sessionSecret);
      seed({ themeRepo, settingsRepo });
      seed({ themeRepo, settingsRepo });
      expect(themeRepo.list()).toHaveLength(9);
      expect(settingsRepo.get(SETTINGS_KEYS.sessionSecret)).toBe(firstSecret);
      db.close();
    });
  });
  ```

- [ ] Do NOT run the seed test yet — it imports the repos built in Task 7. Proceed to Task 7; the seed test runs green at the end of Task 7. (Stage the files now so they are committed together with the repos, or commit presets/seed code as part of Task 7's final commit. For tracking, leave this checkbox checked once the files above exist on disk.)

---

### Task 7 — Repositories (settings / theme / event / photo)

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/settingsRepo.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/themeRepo.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/eventRepo.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/photoRepo.ts`
- Test: `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/__tests__/settingsRepo.test.ts`
- Test: `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/__tests__/themeRepo.test.ts`
- Test: `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/__tests__/eventRepo.test.ts`
- Test: `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/__tests__/photoRepo.test.ts`

#### 7a — settingsRepo

- [ ] Write failing test `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/__tests__/settingsRepo.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { openMemoryDb } from '../../connection.js';
  import { migrate } from '../../migrate.js';
  import { makeSettingsRepo } from '../settingsRepo.js';

  function repo() {
    const db = openMemoryDb();
    migrate(db);
    return { db, settings: makeSettingsRepo(db) };
  }

  describe('settingsRepo', () => {
    it('returns undefined for a missing key', () => {
      const { db, settings } = repo();
      expect(settings.get('nope')).toBeUndefined();
      db.close();
    });

    it('sets and gets a string value (upsert overwrites)', () => {
      const { db, settings } = repo();
      settings.set('k', 'v1');
      expect(settings.get('k')).toBe('v1');
      settings.set('k', 'v2');
      expect(settings.get('k')).toBe('v2');
      db.close();
    });

    it('stores and reads JSON round-trip', () => {
      const { db, settings } = repo();
      settings.setJson('cfg', { a: 1, b: ['x', 'y'] });
      expect(settings.getJson<{ a: number; b: string[] }>('cfg')).toEqual({ a: 1, b: ['x', 'y'] });
      db.close();
    });

    it('getJson returns undefined for a missing key', () => {
      const { db, settings } = repo();
      expect(settings.getJson('missing')).toBeUndefined();
      db.close();
    });
  });
  ```

- [ ] Run, confirm FAIL (`../settingsRepo.js` missing):

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/repositories/__tests__/settingsRepo.test.ts
  ```

  Expected: FAIL — cannot resolve module.

- [ ] Implement `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/settingsRepo.ts`:

  ```ts
  import type { Db } from '../connection.js';

  export interface SettingsRepo {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    getJson<T>(key: string): T | undefined;
    setJson(key: string, value: unknown): void;
  }

  export function makeSettingsRepo(db: Db): SettingsRepo {
    const selectStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const upsertStmt = db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );

    function get(key: string): string | undefined {
      const row = selectStmt.get(key) as { value: string } | undefined;
      return row?.value;
    }

    function set(key: string, value: string): void {
      upsertStmt.run(key, value);
    }

    function getJson<T>(key: string): T | undefined {
      const raw = get(key);
      if (raw === undefined) return undefined;
      return JSON.parse(raw) as T;
    }

    function setJson(key: string, value: unknown): void {
      set(key, JSON.stringify(value));
    }

    return { get, set, getJson, setJson };
  }
  ```

- [ ] Run, confirm PASS:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/repositories/__tests__/settingsRepo.test.ts
  ```

  Expected: `Test Files  1 passed (1)`, 4 tests pass.

#### 7b — themeRepo

- [ ] Write failing test `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/__tests__/themeRepo.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import type { ThemeTokens } from '@rtpa/shared';
  import { openMemoryDb } from '../../connection.js';
  import { migrate } from '../../migrate.js';
  import { makeThemeRepo } from '../themeRepo.js';

  const tokens: ThemeTokens = {
    background: { type: 'solid', value: '#000000' },
    ambient: 'none',
    frame: { style: 'thin', borderColor: '#fff', borderWidth: 1, radius: 4, shadow: false },
    caption: { enabled: true, bg: '#000', color: '#fff' },
    font: 'Inter',
    accent: '#abc',
  };

  function repo() {
    const db = openMemoryDb();
    migrate(db);
    return { db, themes: makeThemeRepo(db) };
  }

  describe('themeRepo', () => {
    it('create makes a non-preset theme with a generated id', () => {
      const { db, themes } = repo();
      const t = themes.create({ name: 'My Theme', tokens });
      expect(t.id).toBeTruthy();
      expect(t.isPreset).toBe(false);
      expect(t.name).toBe('My Theme');
      expect(t.tokens).toEqual(tokens);
      expect(themes.getById(t.id)).toEqual(t);
      db.close();
    });

    it('list returns created themes', () => {
      const { db, themes } = repo();
      themes.create({ name: 'A', tokens });
      themes.create({ name: 'B', tokens });
      expect(themes.list()).toHaveLength(2);
      db.close();
    });

    it('update changes name and/or tokens', () => {
      const { db, themes } = repo();
      const t = themes.create({ name: 'A', tokens });
      const updated = themes.update(t.id, { name: 'A2' });
      expect(updated?.name).toBe('A2');
      expect(updated?.tokens).toEqual(tokens);
      const newTokens: ThemeTokens = { ...tokens, accent: '#999' };
      const updated2 = themes.update(t.id, { tokens: newTokens });
      expect(updated2?.tokens.accent).toBe('#999');
      db.close();
    });

    it('update returns undefined for a missing id', () => {
      const { db, themes } = repo();
      expect(themes.update('missing', { name: 'x' })).toBeUndefined();
      db.close();
    });

    it('upsertPreset is idempotent and overwrites tokens', () => {
      const { db, themes } = repo();
      themes.upsertPreset({ id: 'preset-x', name: 'X', isPreset: true, tokens });
      themes.upsertPreset({ id: 'preset-x', name: 'X', isPreset: true, tokens: { ...tokens, accent: '#111' } });
      const t = themes.getById('preset-x');
      expect(t?.isPreset).toBe(true);
      expect(t?.tokens.accent).toBe('#111');
      expect(themes.list()).toHaveLength(1);
      db.close();
    });

    it('remove deletes a custom theme but refuses a preset', () => {
      const { db, themes } = repo();
      const custom = themes.create({ name: 'C', tokens });
      themes.upsertPreset({ id: 'preset-y', name: 'Y', isPreset: true, tokens });
      expect(themes.remove(custom.id)).toBe(true);
      expect(themes.getById(custom.id)).toBeUndefined();
      expect(themes.remove('preset-y')).toBe(false);
      expect(themes.getById('preset-y')).toBeDefined();
      db.close();
    });
  });
  ```

- [ ] Run, confirm FAIL:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/repositories/__tests__/themeRepo.test.ts
  ```

  Expected: FAIL — cannot resolve `../themeRepo.js`.

- [ ] Implement `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/themeRepo.ts`:

  ```ts
  import { nanoid } from 'nanoid';
  import type { Theme, ThemeTokens } from '@rtpa/shared';
  import type { Db } from '../connection.js';

  export interface ThemeRepo {
    list(): Theme[];
    getById(id: string): Theme | undefined;
    create(input: { name: string; tokens: ThemeTokens }): Theme;
    update(id: string, input: { name?: string; tokens?: ThemeTokens }): Theme | undefined;
    remove(id: string): boolean;
    upsertPreset(theme: Theme): void;
  }

  interface ThemeRow {
    id: string;
    name: string;
    is_preset: number;
    tokens: string;
  }

  function rowToTheme(row: ThemeRow): Theme {
    return {
      id: row.id,
      name: row.name,
      isPreset: row.is_preset === 1,
      tokens: JSON.parse(row.tokens) as ThemeTokens,
    };
  }

  export function makeThemeRepo(db: Db): ThemeRepo {
    const selById = db.prepare('SELECT id, name, is_preset, tokens FROM themes WHERE id = ?');
    const selAll = db.prepare('SELECT id, name, is_preset, tokens FROM themes ORDER BY is_preset DESC, name ASC');
    const insert = db.prepare('INSERT INTO themes (id, name, is_preset, tokens) VALUES (?, ?, ?, ?)');
    const upsert = db.prepare(
      `INSERT INTO themes (id, name, is_preset, tokens) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_preset = excluded.is_preset, tokens = excluded.tokens`,
    );
    const updName = db.prepare('UPDATE themes SET name = ? WHERE id = ?');
    const updTokens = db.prepare('UPDATE themes SET tokens = ? WHERE id = ?');
    const del = db.prepare('DELETE FROM themes WHERE id = ?');

    function getById(id: string): Theme | undefined {
      const row = selById.get(id) as ThemeRow | undefined;
      return row ? rowToTheme(row) : undefined;
    }

    function list(): Theme[] {
      return (selAll.all() as ThemeRow[]).map(rowToTheme);
    }

    function create(input: { name: string; tokens: ThemeTokens }): Theme {
      const id = nanoid();
      insert.run(id, input.name, 0, JSON.stringify(input.tokens));
      return { id, name: input.name, isPreset: false, tokens: input.tokens };
    }

    function update(id: string, input: { name?: string; tokens?: ThemeTokens }): Theme | undefined {
      const existing = getById(id);
      if (!existing) return undefined;
      if (input.name !== undefined) updName.run(input.name, id);
      if (input.tokens !== undefined) updTokens.run(JSON.stringify(input.tokens), id);
      return getById(id);
    }

    function remove(id: string): boolean {
      const existing = getById(id);
      if (!existing || existing.isPreset) return false;
      del.run(id);
      return true;
    }

    function upsertPreset(theme: Theme): void {
      upsert.run(theme.id, theme.name, theme.isPreset ? 1 : 0, JSON.stringify(theme.tokens));
    }

    return { list, getById, create, update, remove, upsertPreset };
  }
  ```

- [ ] Run, confirm PASS:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/repositories/__tests__/themeRepo.test.ts
  ```

  Expected: `Test Files  1 passed (1)`, 6 tests pass.

#### 7c — eventRepo

- [ ] Write failing test `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/__tests__/eventRepo.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { DEFAULT_MOTION_CONFIG, DEFAULT_THEME_ID } from '@rtpa/shared';
  import { openMemoryDb } from '../../connection.js';
  import { migrate } from '../../migrate.js';
  import { makeThemeRepo } from '../themeRepo.js';
  import { makeEventRepo } from '../eventRepo.js';
  import { PRESET_THEMES } from '../../presets.js';

  function setup() {
    const db = openMemoryDb();
    migrate(db);
    const themes = makeThemeRepo(db);
    for (const t of PRESET_THEMES) themes.upsertPreset(t);
    const events = makeEventRepo(db);
    return { db, events };
  }

  describe('eventRepo', () => {
    it('create returns an EventDetail with parsed motionConfig and zero photoCount', () => {
      const { db, events } = setup();
      const e = events.create({
        name: 'Birthday', code: 'bday', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG,
      });
      expect(e.code).toBe('bday');
      expect(e.name).toBe('Birthday');
      expect(e.themeId).toBe(DEFAULT_THEME_ID);
      expect(e.isActive).toBe(false);
      expect(e.uploadEnabled).toBe(true);
      expect(e.status).toBe('active');
      expect(e.photoCount).toBe(0);
      expect(e.motionConfig).toEqual(DEFAULT_MOTION_CONFIG);
      expect(typeof e.createdAt).toBe('string');
      db.close();
    });

    it('getById and getByCode round-trip', () => {
      const { db, events } = setup();
      const e = events.create({ name: 'A', code: 'aaa', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
      expect(events.getById(e.id)?.code).toBe('aaa');
      expect(events.getByCode('aaa')?.id).toBe(e.id);
      expect(events.getById('missing')).toBeUndefined();
      expect(events.getByCode('missing')).toBeUndefined();
      db.close();
    });

    it('codeExists reflects existing codes', () => {
      const { db, events } = setup();
      events.create({ name: 'A', code: 'taken', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
      expect(events.codeExists('taken')).toBe(true);
      expect(events.codeExists('free')).toBe(false);
      db.close();
    });

    it('activate sets the target active and pauses all others', () => {
      const { db, events } = setup();
      const a = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
      const b = events.create({ name: 'B', code: 'b', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
      events.activate(a.id);
      events.activate(b.id);
      expect(events.getById(a.id)?.isActive).toBe(false);
      expect(events.getById(a.id)?.status).toBe('paused');
      expect(events.getById(b.id)?.isActive).toBe(true);
      expect(events.getById(b.id)?.status).toBe('active');
      db.close();
    });

    it('setUploadEnabled toggles the flag', () => {
      const { db, events } = setup();
      const a = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
      events.setUploadEnabled(a.id, false);
      expect(events.getById(a.id)?.uploadEnabled).toBe(false);
      events.setUploadEnabled(a.id, true);
      expect(events.getById(a.id)?.uploadEnabled).toBe(true);
      db.close();
    });

    it('end marks status ended, inactive, uploads off', () => {
      const { db, events } = setup();
      const a = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
      events.activate(a.id);
      events.end(a.id);
      const after = events.getById(a.id);
      expect(after?.status).toBe('ended');
      expect(after?.isActive).toBe(false);
      expect(after?.uploadEnabled).toBe(false);
      db.close();
    });

    it('setMotionConfig and setTheme persist changes', () => {
      const { db, events } = setup();
      const a = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
      const newCfg = { ...DEFAULT_MOTION_CONFIG, speed: 2, maxOnCanvas: 12 };
      events.setMotionConfig(a.id, newCfg);
      expect(events.getById(a.id)?.motionConfig.speed).toBe(2);
      expect(events.getById(a.id)?.motionConfig.maxOnCanvas).toBe(12);
      const other = PRESET_THEMES[2]!.id;
      events.setTheme(a.id, other);
      expect(events.getById(a.id)?.themeId).toBe(other);
      db.close();
    });

    it('list returns summaries newest-first with photoCount', () => {
      const { db, events } = setup();
      const a = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
      const b = events.create({ name: 'B', code: 'b', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
      // insert a photo for b directly to assert photoCount join
      db.prepare(
        `INSERT INTO photos (id, event_id, uploader_name, file_path, display_path, thumb_path,
            media_type, width, height, duration_ms, created_at, is_hidden, device_id, user_agent, ip_address)
         VALUES ('p1', ?, 'Guest', 'f', 'd', 't', 'image', 100, 100, NULL, '2026-06-02T00:00:00.000Z', 0, 'dev', 'ua', 'ip')`,
      ).run(b.id);
      const list = events.list();
      expect(list).toHaveLength(2);
      const byId = Object.fromEntries(list.map((e) => [e.id, e]));
      expect(byId[b.id]!.photoCount).toBe(1);
      expect(byId[a.id]!.photoCount).toBe(0);
      // newest-first: b was created after a
      expect(list[0]!.id).toBe(b.id);
      db.close();
    });
  });
  ```

- [ ] Run, confirm FAIL:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/repositories/__tests__/eventRepo.test.ts
  ```

  Expected: FAIL — cannot resolve `../eventRepo.js`.

- [ ] Implement `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/eventRepo.ts`:

  ```ts
  import { nanoid } from 'nanoid';
  import type { EventSummary, EventDetail, EventStatus, MotionConfig } from '@rtpa/shared';
  import type { Db } from '../connection.js';

  export interface EventRepo {
    list(): EventSummary[];
    getById(id: string): EventDetail | undefined;
    getByCode(code: string): EventDetail | undefined;
    create(input: { name: string; code: string; themeId: string; motionConfig: MotionConfig }): EventDetail;
    activate(id: string): void;
    setUploadEnabled(id: string, enabled: boolean): void;
    end(id: string): void;
    setMotionConfig(id: string, motionConfig: MotionConfig): void;
    setTheme(id: string, themeId: string): void;
    codeExists(code: string): boolean;
  }

  interface EventRow {
    id: string;
    code: string;
    name: string;
    created_at: string;
    is_active: number;
    upload_enabled: number;
    status: string;
    theme_id: string;
    motion_config: string;
    photo_count: number;
  }

  const SELECT_DETAIL = `
    SELECT e.id, e.code, e.name, e.created_at, e.is_active, e.upload_enabled,
           e.status, e.theme_id, e.motion_config,
           (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id) AS photo_count
    FROM events e`;

  function rowToSummary(row: EventRow): EventSummary {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      createdAt: row.created_at,
      isActive: row.is_active === 1,
      uploadEnabled: row.upload_enabled === 1,
      status: row.status as EventStatus,
      themeId: row.theme_id,
      photoCount: row.photo_count,
    };
  }

  function rowToDetail(row: EventRow): EventDetail {
    return {
      ...rowToSummary(row),
      motionConfig: JSON.parse(row.motion_config) as MotionConfig,
    };
  }

  export function makeEventRepo(db: Db): EventRepo {
    const selById = db.prepare(`${SELECT_DETAIL} WHERE e.id = ?`);
    const selByCode = db.prepare(`${SELECT_DETAIL} WHERE e.code = ?`);
    const selAll = db.prepare(`${SELECT_DETAIL} ORDER BY e.created_at DESC, e.id DESC`);
    const insert = db.prepare(
      `INSERT INTO events (id, code, name, created_at, is_active, upload_enabled, status, theme_id, motion_config)
       VALUES (?, ?, ?, ?, 0, 1, 'active', ?, ?)`,
    );
    const pauseOthers = db.prepare(`UPDATE events SET is_active = 0, status = 'paused' WHERE id != ?`);
    const activateOne = db.prepare(`UPDATE events SET is_active = 1, status = 'active' WHERE id = ?`);
    const setUpload = db.prepare(`UPDATE events SET upload_enabled = ? WHERE id = ?`);
    const endStmt = db.prepare(`UPDATE events SET status = 'ended', is_active = 0, upload_enabled = 0 WHERE id = ?`);
    const setMotion = db.prepare(`UPDATE events SET motion_config = ? WHERE id = ?`);
    const setThemeStmt = db.prepare(`UPDATE events SET theme_id = ? WHERE id = ?`);
    const existsStmt = db.prepare(`SELECT 1 FROM events WHERE code = ? LIMIT 1`);

    function getById(id: string): EventDetail | undefined {
      const row = selById.get(id) as EventRow | undefined;
      return row ? rowToDetail(row) : undefined;
    }

    function getByCode(code: string): EventDetail | undefined {
      const row = selByCode.get(code) as EventRow | undefined;
      return row ? rowToDetail(row) : undefined;
    }

    function list(): EventSummary[] {
      return (selAll.all() as EventRow[]).map(rowToSummary);
    }

    function create(input: { name: string; code: string; themeId: string; motionConfig: MotionConfig }): EventDetail {
      const id = nanoid();
      const createdAt = new Date().toISOString();
      insert.run(id, input.code, input.name, createdAt, input.themeId, JSON.stringify(input.motionConfig));
      return getById(id)!;
    }

    function activate(id: string): void {
      const tx = db.transaction(() => {
        pauseOthers.run(id);
        activateOne.run(id);
      });
      tx();
    }

    function setUploadEnabled(id: string, enabled: boolean): void {
      setUpload.run(enabled ? 1 : 0, id);
    }

    function end(id: string): void {
      endStmt.run(id);
    }

    function setMotionConfig(id: string, motionConfig: MotionConfig): void {
      setMotion.run(JSON.stringify(motionConfig), id);
    }

    function setTheme(id: string, themeId: string): void {
      setThemeStmt.run(themeId, id);
    }

    function codeExists(code: string): boolean {
      return existsStmt.get(code) !== undefined;
    }

    return {
      list, getById, getByCode, create, activate,
      setUploadEnabled, end, setMotionConfig, setTheme, codeExists,
    };
  }
  ```

- [ ] Run, confirm PASS:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/repositories/__tests__/eventRepo.test.ts
  ```

  Expected: `Test Files  1 passed (1)`, 8 tests pass.

#### 7d — photoRepo

- [ ] Write failing test `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/__tests__/photoRepo.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { DEFAULT_MOTION_CONFIG, DEFAULT_THEME_ID } from '@rtpa/shared';
  import { openMemoryDb } from '../../connection.js';
  import { migrate } from '../../migrate.js';
  import { makeThemeRepo } from '../themeRepo.js';
  import { makeEventRepo } from '../eventRepo.js';
  import { makePhotoRepo } from '../photoRepo.js';
  import { PRESET_THEMES } from '../../presets.js';

  function setup() {
    const db = openMemoryDb();
    migrate(db);
    const themes = makeThemeRepo(db);
    for (const t of PRESET_THEMES) themes.upsertPreset(t);
    const events = makeEventRepo(db);
    const photos = makePhotoRepo(db);
    const ev = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
    return { db, photos, eventId: ev.id };
  }

  function baseInput(eventId: string, over: Partial<Parameters<ReturnType<typeof makePhotoRepo>['create']>[0]> = {}) {
    return {
      eventId,
      uploaderName: 'Guest',
      filePath: `${eventId}/orig.jpg`,
      displayPath: 'abc123.jpg',
      thumbPath: 'abc123.jpg',
      mediaType: 'image' as const,
      width: 1200,
      height: 800,
      durationMs: null as number | null,
      deviceId: 'dev-1',
      userAgent: 'UA',
      ipAddress: '1.2.3.4',
      ...over,
    };
  }

  describe('photoRepo', () => {
    it('create returns a PhotoAdmin with mapped fields and derived urls', () => {
      const { db, photos, eventId } = setup();
      const p = photos.create(baseInput(eventId, { displayPath: 'pic.jpg', thumbPath: 'pic.jpg' }));
      expect(p.id).toBeTruthy();
      expect(p.eventId).toBe(eventId);
      expect(p.uploaderName).toBe('Guest');
      expect(p.mediaType).toBe('image');
      expect(p.isHidden).toBe(false);
      expect(p.durationMs).toBeNull();
      expect(p.displayUrl).toBe('/media/display/pic.jpg');
      expect(p.thumbUrl).toBe('/media/thumb/pic.jpg');
      expect(p.deviceId).toBe('dev-1');
      expect(p.userAgent).toBe('UA');
      expect(p.ipAddress).toBe('1.2.3.4');
      db.close();
    });

    it('derives urls from the basename of stored paths', () => {
      const { db, photos, eventId } = setup();
      const p = photos.create(baseInput(eventId, {
        displayPath: '/data/media/display/v1.mp4',
        thumbPath: '/data/media/thumb/v1.jpg',
        mediaType: 'video',
        durationMs: 5000,
      }));
      expect(p.displayUrl).toBe('/media/display/v1.mp4');
      expect(p.thumbUrl).toBe('/media/thumb/v1.jpg');
      expect(p.durationMs).toBe(5000);
      db.close();
    });

    it('listForEventAdmin returns newest-first', () => {
      const { db, photos, eventId } = setup();
      const a = photos.create(baseInput(eventId, { uploaderName: 'first' }));
      const b = photos.create(baseInput(eventId, { uploaderName: 'second' }));
      // force deterministic ordering by created_at
      db.prepare('UPDATE photos SET created_at = ? WHERE id = ?').run('2026-06-02T00:00:01.000Z', a.id);
      db.prepare('UPDATE photos SET created_at = ? WHERE id = ?').run('2026-06-02T00:00:02.000Z', b.id);
      const list = photos.listForEventAdmin(eventId);
      expect(list.map((p) => p.uploaderName)).toEqual(['second', 'first']);
      db.close();
    });

    it('listForEventPublic excludes hidden and returns Photo (no private fields)', () => {
      const { db, photos, eventId } = setup();
      const visible = photos.create(baseInput(eventId, { uploaderName: 'shown' }));
      const hidden = photos.create(baseInput(eventId, { uploaderName: 'hidden' }));
      photos.setHidden(hidden.id, true);
      const pub = photos.listForEventPublic(eventId);
      expect(pub).toHaveLength(1);
      expect(pub[0]!.uploaderName).toBe('shown');
      expect(pub[0]!.id).toBe(visible.id);
      expect('deviceId' in pub[0]!).toBe(false);
      db.close();
    });

    it('setHidden toggles is_hidden and getById reflects it', () => {
      const { db, photos, eventId } = setup();
      const p = photos.create(baseInput(eventId));
      photos.setHidden(p.id, true);
      expect(photos.getById(p.id)?.isHidden).toBe(true);
      photos.setHidden(p.id, false);
      expect(photos.getById(p.id)?.isHidden).toBe(false);
      db.close();
    });

    it('remove deletes the row; countForEvent reflects it', () => {
      const { db, photos, eventId } = setup();
      const p = photos.create(baseInput(eventId));
      expect(photos.countForEvent(eventId)).toBe(1);
      photos.remove(p.id);
      expect(photos.getById(p.id)).toBeUndefined();
      expect(photos.countForEvent(eventId)).toBe(0);
      db.close();
    });
  });
  ```

- [ ] Run, confirm FAIL:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/repositories/__tests__/photoRepo.test.ts
  ```

  Expected: FAIL — cannot resolve `../photoRepo.js`.

- [ ] Implement `/home/nathan/claude/RTPartyAlbum/server/src/db/repositories/photoRepo.ts`:

  ```ts
  import { nanoid } from 'nanoid';
  import { basename } from 'node:path';
  import type { Photo, PhotoAdmin, MediaType } from '@rtpa/shared';
  import type { Db } from '../connection.js';

  export interface PhotoCreateInput {
    eventId: string;
    uploaderName: string;
    filePath: string;
    displayPath: string;
    thumbPath: string;
    mediaType: MediaType;
    width: number;
    height: number;
    durationMs: number | null;
    deviceId: string;
    userAgent: string;
    ipAddress: string;
  }

  export interface PhotoRepo {
    create(input: PhotoCreateInput): PhotoAdmin;
    listForEventAdmin(eventId: string): PhotoAdmin[];
    listForEventPublic(eventId: string): Photo[];
    getById(id: string): PhotoAdmin | undefined;
    setHidden(id: string, hidden: boolean): void;
    remove(id: string): void;
    countForEvent(eventId: string): number;
  }

  interface PhotoRow {
    id: string;
    event_id: string;
    uploader_name: string;
    file_path: string;
    display_path: string;
    thumb_path: string;
    media_type: string;
    width: number;
    height: number;
    duration_ms: number | null;
    created_at: string;
    is_hidden: number;
    device_id: string;
    user_agent: string;
    ip_address: string;
  }

  function displayUrlOf(displayPath: string): string {
    return `/media/display/${basename(displayPath)}`;
  }

  function thumbUrlOf(thumbPath: string): string {
    return `/media/thumb/${basename(thumbPath)}`;
  }

  function rowToPhoto(row: PhotoRow): Photo {
    return {
      id: row.id,
      eventId: row.event_id,
      uploaderName: row.uploader_name,
      mediaType: row.media_type as MediaType,
      width: row.width,
      height: row.height,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
      isHidden: row.is_hidden === 1,
      displayUrl: displayUrlOf(row.display_path),
      thumbUrl: thumbUrlOf(row.thumb_path),
    };
  }

  function rowToPhotoAdmin(row: PhotoRow): PhotoAdmin {
    return {
      ...rowToPhoto(row),
      deviceId: row.device_id,
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
    };
  }

  const COLS = `id, event_id, uploader_name, file_path, display_path, thumb_path,
    media_type, width, height, duration_ms, created_at, is_hidden,
    device_id, user_agent, ip_address`;

  export function makePhotoRepo(db: Db): PhotoRepo {
    const insert = db.prepare(
      `INSERT INTO photos (${COLS})
       VALUES (@id, @event_id, @uploader_name, @file_path, @display_path, @thumb_path,
               @media_type, @width, @height, @duration_ms, @created_at, 0,
               @device_id, @user_agent, @ip_address)`,
    );
    const selById = db.prepare(`SELECT ${COLS} FROM photos WHERE id = ?`);
    const selAdmin = db.prepare(`SELECT ${COLS} FROM photos WHERE event_id = ? ORDER BY created_at DESC, id DESC`);
    const selPublic = db.prepare(
      `SELECT ${COLS} FROM photos WHERE event_id = ? AND is_hidden = 0 ORDER BY created_at DESC, id DESC`,
    );
    const setHiddenStmt = db.prepare(`UPDATE photos SET is_hidden = ? WHERE id = ?`);
    const del = db.prepare(`DELETE FROM photos WHERE id = ?`);
    const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM photos WHERE event_id = ?`);

    function create(input: PhotoCreateInput): PhotoAdmin {
      const id = nanoid();
      const createdAt = new Date().toISOString();
      insert.run({
        id,
        event_id: input.eventId,
        uploader_name: input.uploaderName,
        file_path: input.filePath,
        display_path: input.displayPath,
        thumb_path: input.thumbPath,
        media_type: input.mediaType,
        width: input.width,
        height: input.height,
        duration_ms: input.durationMs,
        created_at: createdAt,
        device_id: input.deviceId,
        user_agent: input.userAgent,
        ip_address: input.ipAddress,
      });
      return getById(id)!;
    }

    function getById(id: string): PhotoAdmin | undefined {
      const row = selById.get(id) as PhotoRow | undefined;
      return row ? rowToPhotoAdmin(row) : undefined;
    }

    function listForEventAdmin(eventId: string): PhotoAdmin[] {
      return (selAdmin.all(eventId) as PhotoRow[]).map(rowToPhotoAdmin);
    }

    function listForEventPublic(eventId: string): Photo[] {
      return (selPublic.all(eventId) as PhotoRow[]).map(rowToPhoto);
    }

    function setHidden(id: string, hidden: boolean): void {
      setHiddenStmt.run(hidden ? 1 : 0, id);
    }

    function remove(id: string): void {
      del.run(id);
    }

    function countForEvent(eventId: string): number {
      const row = countStmt.get(eventId) as { n: number };
      return row.n;
    }

    return { create, listForEventAdmin, listForEventPublic, getById, setHidden, remove, countForEvent };
  }
  ```

- [ ] Run, confirm PASS:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/repositories/__tests__/photoRepo.test.ts
  ```

  Expected: `Test Files  1 passed (1)`, 6 tests pass.

#### 7e — run the deferred seed test (Task 6) now that repos exist

- [ ] Run the seed test from Task 6 and confirm PASS:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/db/__tests__/seed.test.ts
  ```

  Expected: `Test Files  1 passed (1)`, 4 tests pass.

- [ ] Run the full server suite to confirm nothing regressed:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server
  ```

  Expected: all test files pass (config, connection, migrate, seed, settingsRepo, themeRepo, eventRepo, photoRepo).

- [ ] Commit the presets/seed (Task 6) and all four repositories (Task 7) together:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && git add server/src/db && git commit -m "feat(server): add theme presets, idempotent seeding, and tested repositories"
  ```

---

### Task 8 — Express app factory, health + media routes, error handler

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/middleware/errorHandler.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/routes/health.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/routes/media.ts`
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/app.ts`
- Test: `/home/nathan/claude/RTPartyAlbum/server/src/__tests__/app.test.ts`

Steps:

- [ ] Write failing test `/home/nathan/claude/RTPartyAlbum/server/src/__tests__/app.test.ts`:

  ```ts
  import { describe, it, expect, afterEach } from 'vitest';
  import request from 'supertest';
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { buildApp } from '../app.js';
  import { openMemoryDb } from '../db/connection.js';
  import { loadConfig } from '../config.js';

  const dirs: string[] = [];
  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'rtpa-app-'));
    dirs.push(d);
    return d;
  }
  /** A minimal deps object for app-level tests (health/404 don't touch the db). */
  function deps() {
    return { db: openMemoryDb(), config: loadConfig({ dataDir: tmp() }) };
  }
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  describe('buildApp', () => {
    it('GET /api/health returns {status:"ok"}', async () => {
      const app = buildApp(deps());
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('unknown /api route returns JSON 404 via error handler', async () => {
      const app = buildApp(deps());
      const res = await request(app).get('/api/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
  ```

- [ ] Run, confirm FAIL:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/__tests__/app.test.ts
  ```

  Expected: FAIL — cannot resolve `../app.js`.

- [ ] Implement `/home/nathan/claude/RTPartyAlbum/server/src/middleware/errorHandler.ts`:

  ```ts
  import type { Request, Response, NextFunction } from 'express';

  export class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'HttpError';
    }
  }

  /** 404 handler — must be registered after all routes. */
  export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
    next(new HttpError(404, 'Not Found'));
  }

  /** Terminal JSON error handler — must be registered last. */
  export function errorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    res.status(status).json({ error: message });
  }
  ```

- [ ] Implement `/home/nathan/claude/RTPartyAlbum/server/src/routes/health.ts`:

  ```ts
  import { Router } from 'express';

  export function healthRouter(): Router {
    const router = Router();
    router.get('/', (_req, res) => {
      res.json({ status: 'ok' });
    });
    return router;
  }
  ```

- [ ] Implement `/home/nathan/claude/RTPartyAlbum/server/src/routes/media.ts`:

  ```ts
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
  ```

- [ ] Implement `/home/nathan/claude/RTPartyAlbum/server/src/app.ts`:

  ```ts
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
  ```

- [ ] Run, confirm PASS:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test -w @rtpa/server -- src/__tests__/app.test.ts
  ```

  Expected: `Test Files  1 passed (1)`, 2 tests pass.

- [ ] Commit:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && git add server/src/app.ts server/src/routes server/src/middleware && git commit -m "feat(server): add Express app factory with health, media, and error handling"
  ```

---

### Task 9 — Entry point (wire it all together)

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/server/src/index.ts`

(No unit test — smoke instructions only.)

Steps:

- [ ] Implement `/home/nathan/claude/RTPartyAlbum/server/src/index.ts`:

  ```ts
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
    seed({ themeRepo, settingsRepo });

    const app = buildApp({ db, config });
    app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(`[rtpa] server listening on :${config.port} (env=${config.nodeEnv})`);
    });
  }

  main();
  ```

- [ ] Type-check the whole server package builds cleanly:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm run build -w @rtpa/server
  ```

  Expected: exits 0; emits `server/dist/index.js` and friends with no TS errors.

- [ ] Smoke test the running server (dev mode, in-repo `./.data` / `./.uploads`). Start it, hit health, then stop:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && (npm run dev -w @rtpa/server &) ; sleep 4 ; curl -s http://localhost:8080/api/health ; echo ; pkill -f "tsx watch src/index.ts"
  ```

  Expected: prints `{"status":"ok"}`. The server log line `[rtpa] server listening on :8080 (env=development)` appears. A `./.data/rtpa.db` file is created and `./.data/media/display` + `./.data/media/thumb` + `./.uploads` dirs exist.

- [ ] Commit:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && git add server/src/index.ts && git commit -m "feat(server): add entry point wiring config, migrate, seed, and http listen"
  ```

---

### Task 10 — Docker packaging

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/Dockerfile`
- Create: `/home/nathan/claude/RTPartyAlbum/docker-compose.yml`
- Create: `/home/nathan/claude/RTPartyAlbum/.dockerignore`

(Smoke-test instructions only — no unit tests.)

Steps:

- [ ] Create `/home/nathan/claude/RTPartyAlbum/.dockerignore`:

  ```dockerignore
  node_modules
  **/node_modules
  **/dist
  .git
  .gitignore
  .data
  .uploads
  *.db
  *.db-shm
  *.db-wal
  docs
  .superpowers
  .omc
  npm-debug.log*
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/Dockerfile` (multi-stage: build shared+server+web, slim runtime with ffmpeg for later plans):

  ```dockerfile
  # syntax=docker/dockerfile:1

  # ---- Build stage ----
  FROM node:20-slim AS build
  WORKDIR /app

  # Native build deps for better-sqlite3 / sharp during npm install
  RUN apt-get update \
      && apt-get install -y --no-install-recommends python3 make g++ \
      && rm -rf /var/lib/apt/lists/*

  # Install with full workspace context so npm workspaces resolve
  COPY package.json package-lock.json* tsconfig.base.json ./
  COPY shared/package.json ./shared/package.json
  COPY server/package.json ./server/package.json
  COPY web/package.json ./web/package.json
  RUN npm install

  # Copy sources and build shared + server (web build is a placeholder in Plan 1)
  COPY shared ./shared
  COPY server ./server
  COPY web ./web
  RUN npm run build -w @rtpa/shared \
      && npm run build -w @rtpa/server \
      && npm run build -w @rtpa/web

  # Prune dev dependencies for a lean runtime node_modules
  RUN npm prune --omit=dev

  # ---- Runtime stage ----
  FROM node:20-slim AS runtime
  WORKDIR /app
  ENV NODE_ENV=production

  # ffmpeg installed for video processing in later plans
  RUN apt-get update \
      && apt-get install -y --no-install-recommends ffmpeg \
      && rm -rf /var/lib/apt/lists/*

  COPY --from=build /app/package.json ./package.json
  COPY --from=build /app/node_modules ./node_modules
  COPY --from=build /app/shared/package.json ./shared/package.json
  COPY --from=build /app/shared/dist ./shared/dist
  COPY --from=build /app/server/package.json ./server/package.json
  COPY --from=build /app/server/dist ./server/dist

  VOLUME ["/data", "/uploads"]
  EXPOSE 8080

  CMD ["node", "server/dist/index.js"]
  ```

- [ ] Create `/home/nathan/claude/RTPartyAlbum/docker-compose.yml`:

  ```yaml
  services:
    rtpartyalbum:
      build:
        context: .
        dockerfile: Dockerfile
      image: rtpartyalbum:latest
      container_name: rtpartyalbum
      restart: unless-stopped
      ports:
        - "8080:8080"
      environment:
        NODE_ENV: production
        PORT: "8080"
        ADMIN_PASSWORD: "${ADMIN_PASSWORD:-change-me}"
        PUBLIC_BASE_URL: "${PUBLIC_BASE_URL:-}"
      volumes:
        - ./.docker-data:/data
        - ./.docker-uploads:/uploads
  ```

- [ ] Smoke test: build the image (no run needed for Plan 1). This validates the multi-stage build, native module compilation, and that `server/dist/index.js` exists:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && docker build -t rtpartyalbum:plan1 .
  ```

  Expected: build completes with `naming to docker.io/library/rtpartyalbum:plan1`. No `npm ERR!` and the final `node server/dist/index.js` layer is produced.

- [ ] (Optional deeper smoke) Run the container briefly and confirm health, then stop it:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && docker run -d --name rtpa-smoke -p 8081:8080 -e ADMIN_PASSWORD=test rtpartyalbum:plan1 ; sleep 4 ; curl -s http://localhost:8081/api/health ; echo ; docker rm -f rtpa-smoke
  ```

  Expected: prints `{"status":"ok"}`, then the container is removed.

- [ ] Commit:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && git add Dockerfile docker-compose.yml .dockerignore && git commit -m "chore: add multi-stage Dockerfile, compose, and dockerignore"
  ```

---

### Task 11 — Root README (dev setup + test commands)

**Files:**
- Create: `/home/nathan/claude/RTPartyAlbum/README.md`

Steps:

- [ ] Create `/home/nathan/claude/RTPartyAlbum/README.md`:

  ```markdown
  # RTPartyAlbum

  Self-hosted live party photo/video sharing. Guests scan a QR code, upload from
  their phone, and contributions appear on a live animated "gliding canvas" display.
  Admin console manages events, moderates, themes, and tunes canvas motion. Ships as
  a single Docker image for Unraid behind a reverse proxy.

  ## Monorepo layout

  npm workspaces:

  - `shared/` — `@rtpa/shared`: canonical TypeScript types + constants.
  - `server/` — `@rtpa/server`: Express + better-sqlite3 + Socket.IO API and static host.
  - `web/` — `@rtpa/web`: React (Vite) front-end (placeholder until later plans).

  ## Requirements

  - Node 20+
  - npm 10+
  - (Docker optional) Docker for container builds; ffmpeg is bundled in the image.

  ## Dev setup

  ```bash
  npm install                 # installs all workspaces
  npm run build -w @rtpa/shared
  npm run dev -w @rtpa/server  # starts the API on http://localhost:8080
  ```

  In development the server stores data under `./.data` and originals under
  `./.uploads` (auto-created). Health check:

  ```bash
  curl http://localhost:8080/api/health   # -> {"status":"ok"}
  ```

  ## Configuration (env vars)

  | Var | Default (prod) | Default (dev) | Purpose |
  |-----|----------------|---------------|---------|
  | `PORT` | `8080` | `8080` | HTTP listen port |
  | `DATA_DIR` | `/data` | `./.data` | SQLite db + derived media |
  | `UPLOADS_DIR` | `/uploads` | `./.uploads` | Original uploads |
  | `ADMIN_PASSWORD` | — | — | Bootstrap admin password |
  | `PUBLIC_BASE_URL` | `` | `` | Base URL for QR codes / share links |
  | `SESSION_SECRET` | generated | generated | Session signing secret (stored in settings if unset) |

  ## Tests

  ```bash
  npm test                       # all workspaces
  npm test -w @rtpa/shared       # shared types/constants
  npm test -w @rtpa/server       # server (vitest)
  npm test -w @rtpa/server -- <file>   # single server test file
  ```

  ## Docker

  ```bash
  docker build -t rtpartyalbum:latest .
  docker compose up --build      # maps :8080, mounts ./.docker-data and ./.docker-uploads
  ```

  Provide `ADMIN_PASSWORD` and `PUBLIC_BASE_URL` via env or a `.env` file next to
  `docker-compose.yml`. On Unraid, mount `/data` and `/uploads` to array shares and
  terminate TLS at your reverse proxy (NPM / SWAG / Cloudflare Tunnel).
  ```

- [ ] Verify the full test suite is green across all workspaces:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && npm test
  ```

  Expected: shared + server suites pass; web prints its placeholder echo. No failures.

- [ ] Commit:

  ```bash
  cd /home/nathan/claude/RTPartyAlbum && git add README.md && git commit -m "docs: add root README with dev setup and test commands"
  ```

---

## Plan 1 self-check

This plan delivers the following contract pieces (everything later plans depend on):

- **Monorepo + tooling:** root `package.json` (workspaces `["shared","server","web"]`), `tsconfig.base.json` (ESM, NodeNext, strict), placeholder `web` package, pinned tech versions from the contracts.
- **`@rtpa/shared`:** `src/types.ts` and `src/constants.ts` copied VERBATIM from the contracts, re-exported via `src/index.ts`, with a passing constants test.
- **Server config:** `server/src/config.ts` `loadConfig(overrides?)` with the exact `Config` shape, `PORT`/`DATA_DIR`/`UPLOADS_DIR`/`ADMIN_PASSWORD`/`PUBLIC_BASE_URL`/`SESSION_SECRET`/`NODE_ENV` handling and NODE_ENV-aware dir defaults.
- **DB layer:** `connection.ts` (WAL + `foreign_keys ON`, in-memory test helper), `migrate.ts` + `migrations/001_init.ts` (schema VERBATIM, idempotent runner with a `migrations` table).
- **Theme presets + seeding:** all 9 presets with stable ids (`preset-midnight-gala` … `preset-starfield`, `isPreset:true`) and full `ThemeTokens`; `seed.ts` idempotently upserts presets and ensures default media limits, public base url, and a generated session secret; `DEFAULT_THEME_ID` present.
- **Repositories:** `settingsRepo`, `themeRepo`, `eventRepo`, `photoRepo` implementing the EXACT locked signatures, with snake_case→camelCase mapping, JSON parsing, `0/1`→boolean, `displayUrl`/`thumbUrl` derivation (`/media/display/<file>`, `/media/thumb/<file>`), `eventRepo.activate` pausing others, and photo newest-first ordering — all TDD-tested.
- **HTTP foundation:** `app.ts` `buildApp(deps)` factory (no listen), `routes/health.ts` (`GET /api/health → {status:'ok'}`), `routes/media.ts` (static `${dataDir}/media` at `/media`), `middleware/errorHandler.ts`, supertest-verified.
- **Entry + packaging:** `src/index.ts` (config → ensure dirs → openDb → migrate → seed → buildApp → listen), multi-stage `Dockerfile` (ffmpeg installed for later plans, volumes `/data` `/uploads`, expose 8080), `docker-compose.yml`, `.dockerignore`, and a root `README.md`.

**Deferred to later plans (NOT in this plan):** auth (`auth/auth.ts`, Plan 2), realtime (`realtime/realtime.ts`, Plan 2), event/theme/settings/admin routes (Plan 2), media processing services + upload/photo/export routes (Plan 3), and the entire `web` front-end (Plans 4–6).
