# RTPartyAlbum — Shared Contracts (locked)

This file is the single source of truth that all six implementation plans build against.
Types, schema, file paths, route names, env vars, and defaults below are **canonical** —
every plan must use these exact names and signatures.

## Tech stack (pinned)

- **Runtime:** Node 20, **TypeScript ^5.4**, ESM (`"type": "module"`) in every package.
- **Monorepo:** npm workspaces. Packages: `shared`, `server`, `web`.
- **Server:** Express ^4.19, better-sqlite3 ^11, socket.io ^4.7, multer ^1.4.5-lts.1,
  sharp ^0.33, fluent-ffmpeg ^2.1.3 + ffmpeg-static ^5.2, bcryptjs ^2.4,
  jsonwebtoken ^9, cookie-parser ^1.4, express-rate-limit ^7, qrcode ^1.5,
  archiver ^7, zod ^3.23, nanoid ^5.
- **Server tests:** Vitest ^2, supertest ^7. Run TS with `tsx`.
- **Web:** React ^18.3, Vite ^5, @vitejs/plugin-react, react-router-dom ^6.26,
  framer-motion ^11, @tanstack/react-query ^5, socket.io-client ^4.7.
- **Web tests:** Vitest ^2, @testing-library/react ^16, @testing-library/jest-dom,
  jsdom.

## Monorepo layout

```
RTPartyAlbum/
  package.json                 # workspaces: ["shared","server","web"]
  tsconfig.base.json
  Dockerfile
  docker-compose.yml
  .dockerignore
  shared/
    package.json               # name: "@rtpa/shared"
    tsconfig.json
    src/index.ts               # re-exports
    src/types.ts
    src/constants.ts
    src/__tests__/constants.test.ts
  server/
    package.json               # name: "@rtpa/server"
    tsconfig.json
    vitest.config.ts
    src/index.ts               # entry: migrate+seed, start http+socket
    src/app.ts                 # builds Express app (no listen) — testable
    src/config.ts
    src/db/connection.ts
    src/db/migrate.ts
    src/db/migrations/001_init.ts
    src/db/presets.ts          # 9 theme preset token sets
    src/db/seed.ts
    src/db/repositories/settingsRepo.ts
    src/db/repositories/themeRepo.ts
    src/db/repositories/eventRepo.ts
    src/db/repositories/photoRepo.ts
    src/auth/auth.ts           # jwt cookie sign/verify + middleware (Plan 2)
    src/realtime/realtime.ts   # socket.io server + typed emit helpers (Plan 2)
    src/services/eventCode.ts  # code generation (Plan 2)
    src/services/imageService.ts   # sharp (Plan 3)
    src/services/videoService.ts   # ffmpeg (Plan 3)
    src/services/exportService.ts  # archiver zip (Plan 3)
    src/routes/health.ts
    src/routes/adminAuth.ts    # Plan 2
    src/routes/adminEvents.ts  # Plan 2
    src/routes/adminThemes.ts  # Plan 2 (CRUD) — themes
    src/routes/adminSettings.ts# Plan 2
    src/routes/adminPhotos.ts  # Plan 3
    src/routes/adminExport.ts  # Plan 3
    src/routes/publicEvents.ts # Plan 2 (read) + Plan 3 (upload)
    src/routes/media.ts        # static media serving (Plan 1)
    src/middleware/errorHandler.ts
    tests/                     # supertest integration tests
  web/
    package.json               # name: "@rtpa/web"
    tsconfig.json
    vite.config.ts
    index.html
    src/main.tsx
    src/router.tsx
    src/api/client.ts
    src/api/types.ts           # re-export from @rtpa/shared
    src/lib/deviceId.ts
    src/lib/themeCss.ts        # ThemeTokens -> CSSProperties / CSS vars
    src/lib/socket.ts
    src/pages/UploadPage.tsx       # Plan 4
    src/pages/DisplayPage.tsx      # Plan 6
    src/admin/...                  # Plan 5
    src/display/rotationEngine.ts  # Plan 6 (pure, unit-tested)
    src/display/renderer/...       # Plan 6
```

**Dev wiring:** Vite dev server proxies `/api` and `/socket.io` and `/media` to
`http://localhost:8080`. Production: server serves `web/dist` statically and SPA-fallbacks
non-`/api` non-`/media` routes to `index.html`.

## shared/src/types.ts (verbatim — copy exactly)

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

## shared/src/constants.ts (verbatim — copy exactly)

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

## Theme presets (9) — ids and intent (Plan 1 implements full tokens)

`preset-midnight-gala` (default), `preset-warm-bokeh`, `preset-neon-night`,
`preset-clean-light`, `preset-rustic-kraft`, `preset-garden-pastel`,
`preset-monochrome-film`, `preset-confetti-pop`, `preset-starfield`.
All have `isPreset: true`. Stable ids (no random) so seeding is idempotent.

## Database schema — migration 001 (verbatim)

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE themes (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  is_preset INTEGER NOT NULL DEFAULT 0,
  tokens    TEXT NOT NULL              -- JSON ThemeTokens
);

CREATE TABLE events (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  is_active      INTEGER NOT NULL DEFAULT 0,
  upload_enabled INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'active',  -- active|paused|ended
  theme_id       TEXT NOT NULL,
  motion_config  TEXT NOT NULL,                   -- JSON MotionConfig
  FOREIGN KEY (theme_id) REFERENCES themes(id)
);

CREATE TABLE photos (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL,
  uploader_name TEXT NOT NULL,
  file_path    TEXT NOT NULL,    -- original on UPLOADS_DIR
  display_path TEXT NOT NULL,    -- derived on DATA_DIR/media/display
  thumb_path   TEXT NOT NULL,    -- derived on DATA_DIR/media/thumb
  media_type   TEXT NOT NULL,    -- image|video
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  duration_ms  INTEGER,          -- null for images
  created_at   TEXT NOT NULL,
  is_hidden    INTEGER NOT NULL DEFAULT 0,
  device_id    TEXT NOT NULL,
  user_agent   TEXT NOT NULL,
  ip_address   TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX idx_photos_event_created ON photos(event_id, created_at DESC);
```

## Repository method signatures (locked — Plan 1 implements & tests)

```ts
// settingsRepo
get(key: string): string | undefined
set(key: string, value: string): void
getJson<T>(key: string): T | undefined
setJson(key: string, value: unknown): void

// themeRepo
list(): Theme[]
getById(id: string): Theme | undefined
create(input: { name: string; tokens: ThemeTokens }): Theme   // isPreset=false, id=nanoid
update(id: string, input: { name?: string; tokens?: ThemeTokens }): Theme | undefined
remove(id: string): boolean                                   // refuses if isPreset
upsertPreset(theme: Theme): void                              // idempotent seed

// eventRepo
list(): EventSummary[]                       // photoCount included, newest first
getById(id: string): EventDetail | undefined
getByCode(code: string): EventDetail | undefined
create(input: { name: string; code: string; themeId: string; motionConfig: MotionConfig }): EventDetail
activate(id: string): void                   // sets is_active=1,status='active'; others is_active=0,status='paused'
setUploadEnabled(id: string, enabled: boolean): void
end(id: string): void                        // status='ended', is_active=0, upload_enabled=0
setMotionConfig(id: string, motionConfig: MotionConfig): void
setTheme(id: string, themeId: string): void
codeExists(code: string): boolean

// photoRepo
create(input: PhotoCreateInput): PhotoAdmin
listForEventAdmin(eventId: string): PhotoAdmin[]   // newest-first (created_at DESC)
listForEventPublic(eventId: string): Photo[]       // is_hidden=0, newest-first
getById(id: string): PhotoAdmin | undefined
setHidden(id: string, hidden: boolean): void
remove(id: string): void                            // row only; file deletion handled by route/service
countForEvent(eventId: string): number

// PhotoCreateInput
interface PhotoCreateInput {
  eventId: string; uploaderName: string;
  filePath: string; displayPath: string; thumbPath: string;
  mediaType: MediaType; width: number; height: number; durationMs: number | null;
  deviceId: string; userAgent: string; ipAddress: string;
}
```

Row→DTO mapping: repos convert snake_case rows to camelCase DTOs, parse JSON columns,
coerce `0/1`→boolean, and build `displayUrl`/`thumbUrl` from the stored filenames via
`/media/display/<file>` and `/media/thumb/<file>`.

## Config (server/src/config.ts) — env vars

```ts
interface Config {
  port: number;               // PORT, default 8080
  dataDir: string;            // DATA_DIR, default '/data' (dev: './.data')
  uploadsDir: string;         // UPLOADS_DIR, default '/uploads' (dev: './.uploads')
  adminPassword: string | undefined;  // ADMIN_PASSWORD (bootstrap)
  publicBaseUrl: string;      // PUBLIC_BASE_URL, default '' (admin can set later)
  sessionSecret: string;      // SESSION_SECRET; if absent, generated & stored in settings
  nodeEnv: string;            // NODE_ENV
}
export function loadConfig(overrides?: Partial<Config>): Config
```
`DATA_DIR` defaults differ by NODE_ENV (`/data` in production, `./.data` otherwise).
`media` is served from `${dataDir}/media`. Originals live under `${uploadsDir}/<eventId>/`.

## HTTP API (all JSON unless noted). Admin routes require auth cookie.

**Auth**
- `POST /api/admin/login` `{ password }` → 200 sets `rtpa_session` httpOnly cookie | 401
- `POST /api/admin/logout` → 204
- `GET  /api/admin/me` → 200 `{ ok: true }` | 401

**Events (admin)**
- `GET  /api/admin/events` → `EventSummary[]`
- `POST /api/admin/events` `{ name }` → `EventDetail` (active; pauses others)
- `GET  /api/admin/events/:id` → `EventDetail`
- `POST /api/admin/events/:id/activate` → `EventDetail`
- `POST /api/admin/events/:id/upload-state` `{ enabled }` → `EventDetail`
- `POST /api/admin/events/:id/end` → `EventDetail`
- `PUT  /api/admin/events/:id/motion` `{ motionConfig }` → `EventDetail` (broadcast settings:updated)
- `PUT  /api/admin/events/:id/theme` `{ themeId }` → `EventDetail` (broadcast theme:updated)
- `GET  /api/admin/events/:id/qr` → image/png
- `GET  /api/admin/events/:id/photos` → `PhotoAdmin[]`
- `GET  /api/admin/events/:id/export` → application/zip (stream)

**Photos (admin)**
- `POST   /api/admin/photos/:id/hide` `{ hidden }` → 204 (broadcast photo:hidden when hidden=true; when false, broadcast photo:added with the now-visible Photo)
- `DELETE /api/admin/photos/:id` → 204 (delete files; broadcast photo:deleted)

**Themes (admin)**
- `GET    /api/admin/themes` → `Theme[]`
- `POST   /api/admin/themes` `{ name, tokens }` → `Theme`
- `PUT    /api/admin/themes/:id` `{ name?, tokens? }` → `Theme`
- `DELETE /api/admin/themes/:id` → 204 (presets refuse → 409)

**Settings (admin)**
- `GET /api/admin/settings` → `{ publicBaseUrl, mediaLimits }`
- `PUT /api/admin/settings` `{ publicBaseUrl?, mediaLimits? }` → same
- `POST /api/admin/password` `{ current, next }` → 204 | 401

**Public (guest + display)**
- `GET  /api/events/by-code/:code` → `PublicEvent` (404 if not found)
- `GET  /api/events/by-code/:code/photos` → `Photo[]` (visible only)
- `POST /api/events/by-code/:code/upload` (multipart/form-data; fields: `uploaderName`,
  `deviceId`, `files`) → `Photo[]` (429 if rate-limited; 403 if upload disabled/ended)

**Media (static)**
- `GET /media/display/:file`, `GET /media/thumb/:file`

## Socket.IO

- Namespace default. Client: `socket.emit('join', code)`. Server joins room `event:<code>`.
- Server emit helpers in `realtime.ts` (used by routes/services):
  ```ts
  emitPhotoAdded(code: string, photo: Photo): void
  emitPhotoHidden(code: string, id: string): void
  emitPhotoDeleted(code: string, id: string): void
  emitSettingsUpdated(code: string, motionConfig: MotionConfig): void
  emitThemeUpdated(code: string, theme: Theme): void
  ```
- `initRealtime(httpServer): void` attaches io; `app.ts` exposes a setter so routes can
  call helpers. Tests may pass a no-op realtime.

## Media storage & processing rules

- Original: `${uploadsDir}/<eventId>/<photoId><ext>` (ext from detected type).
- Image display: `${dataDir}/media/display/<photoId>.jpg` (sharp: auto-orient, strip
  metadata except orientation, fit inside 1600×1600, jpeg q82).
- Image thumb: `${dataDir}/media/thumb/<photoId>.jpg` (fit inside 480×480, jpeg q75).
- Video display: `${dataDir}/media/display/<photoId>.mp4` (ffmpeg: H.264 yuv420p, faststart,
  trim to `videoMaxDurationSec`, scale longest edge ≤ 1280, no audio needed but keep muted).
- Video thumb/poster: `${dataDir}/media/thumb/<photoId>.jpg` (frame at ~0.5s, ≤480).
- `displayUrl = '/media/display/<photoId>.<jpg|mp4>'`, `thumbUrl = '/media/thumb/<photoId>.jpg'`.
- HEIC images normalized to JPEG by sharp.

## Rotation engine contract (Plan 6, pure module `web/src/display/rotationEngine.ts`)

```ts
import type { MotionConfig, MotionStyle, EnterAnimation, LeaveAnimation, Photo } from '@rtpa/shared';

export interface Tile {
  photo: Photo;
  motion: MotionStyle;
  enter: EnterAnimation;
  leave: LeaveAnimation;
  size: number;            // px longest edge
  x: number; y: number;    // 0..1 normalized position
  rotation: number;        // deg
  bornAt: number;          // ms timestamp admitted
  dwellMs: number;         // computed dwell budget (Infinity if dwell disabled)
  leaving: boolean;
}

export interface EngineState {
  onCanvas: Tile[];
  queue: Photo[];          // waiting to enter (new uploads pushed to front-priority)
  album: Photo[];          // full pool for idle cycling
  config: MotionConfig;
}

export type Rng = () => number;  // injectable for deterministic tests; default Math.random

export function pickWeighted<K extends string>(weights: Record<K, number>, rng: Rng): K
export function computeSize(base: number, variance: number, rng: Rng): number
export function makeTile(photo: Photo, config: MotionConfig, now: number, rng: Rng): Tile
export function enqueueUpload(state: EngineState, photo: Photo): EngineState   // priority
export function tick(state: EngineState, now: number, rng: Rng): EngineState   // evict expired/over-cap, admit from queue/album
export function removePhoto(state: EngineState, photoId: string): EngineState  // hidden/deleted
```
`tick` enforces `onCanvas.length <= config.maxOnCanvas` (hard cap), evicts dwell-expired or
oldest-when-something-waits (marks `leaving`), and admits queue (priority) then album-cycle.
All randomness via injected `rng` so tests are deterministic.

## Test commands

- Root: `npm test` runs all workspaces.
- Server: `npm test -w @rtpa/server` (vitest). Single: `npm test -w @rtpa/server -- <file>`.
- Web: `npm test -w @rtpa/web` (vitest jsdom).
- Shared: `npm test -w @rtpa/shared`.

## Commit convention

Conventional commits (`feat:`, `test:`, `chore:`, `docs:`). Commit after each task's tests pass.

## Cross-plan integration notes (canonical — resolves shared seams)

These pin shared symbols that span plan boundaries. Where an individual plan's prose
disagrees, THIS section wins.

- **Repository factory names:** `makeSettingsRepo`, `makeThemeRepo`, `makeEventRepo`,
  `makePhotoRepo` (NOT `create*Repo`). Each takes `(db: Db)` and returns the typed repo.
  Defined in Plan 1; imported by Plans 2 & 3.
- **App factory:** `buildApp(deps: AppDeps): Express` with
  `AppDeps = { db: Db; config: Config }` (Plan 1). `buildApp` stashes them via
  `app.set('db', db)` / `app.set('config', config)`. Plan 2 widens `AppDeps` with an
  optional `realtime?: RealtimeEmitters` (default `noopRealtime`, also stashed via
  `app.set('realtime', …)`); routers reach these with `req.app.get('db'|'config'|'realtime')`
  and their repos. The media route uses `config.dataDir`.
- **Web socket client `web/src/lib/socket.ts`** (created in Plan 4, the skeleton owner):
  exports `connectSocket(): AppSocket` and `getSocket(): AppSocket` (alias) plus
  `resetSocket()`. Plan 5 uses `getSocket`; Plan 6 uses `connectSocket`/`getSocket`.
- **Web theme helpers `web/src/lib/themeCss.ts`** (Plan 4): exports `themeToCssVars`,
  its alias `themeVars`, `backgroundStyle`, and `frameStyle`. Plan 4 uses
  `themeToCssVars`/`backgroundStyle`; Plan 5 uses `themeVars`/`frameStyle`; Plan 6 may
  reuse `frameStyle`/`backgroundStyle` (it currently also defines local equivalents —
  acceptable).
- **Public web API client `web/src/api/client.ts`** (Plan 4): `getPublicEvent(code)`,
  `getPublicPhotos(code)`, `uploadFiles(...)`. Plan 6 imports `getPublicEvent`/`getPublicPhotos`.
  The admin console (Plan 5) has its OWN client at `web/src/admin/api.ts`.
- **Router `web/src/router.tsx`** (Plan 4) uses `createBrowserRouter` (tests use
  `createMemoryRouter`) with routes `/e/:code` → `UploadPage`, `/e/:code/display` →
  `DisplayPage` placeholder, `/admin/*` → admin placeholder. Plan 5 modifies it to mount
  the real admin subtree; Plan 6 modifies it to mount the real `DisplayPage`.
