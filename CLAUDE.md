# RTPartyAlbum — notes for Claude

Self-hosted live party photo/video wall. Guests scan a QR code, upload from their
phone, and photos glide around a full-screen "living canvas" display (explicitly not a
slideshow). A password-protected admin console manages events, moderation, themes and
canvas motion. Ships as one Docker image for Unraid behind a reverse proxy.

The original design spec and the six implementation plans are in
`docs/superpowers/specs/` and `docs/superpowers/plans/` (`_shared-contracts.md` holds
the shared types/API contract). Read the spec before large feature work.

## Repo layout (npm workspaces, Node 20+)

- `shared/` (`@rtpa/shared`): canonical types (`types.ts`) and defaults (`constants.ts`):
  `MotionConfig`, `ThemeTokens`, `Photo`/`PhotoAdmin`, `PublicEvent`, socket event maps.
  **Build it first** (`npm run build -w @rtpa/shared`): server and web import `shared/dist`.
- `server/` (`@rtpa/server`): Express + better-sqlite3 + Socket.IO on one port (8080).
  - `app.ts` builds the app (no listen; testable with supertest). Repos and the realtime
    emitters are stashed with `app.set(...)` and read in routes via `req.app.get(...)`.
  - `index.ts` boots: dirs, migrate, seed, HTTP + Socket.IO, graceful shutdown.
  - `db/migrations/NNN_name.ts` plus a registration in `db/migrate.ts` (ordered list).
  - `db/seed.ts` is idempotent: upserts preset themes, fills default settings.
  - Routes: `publicEvents.ts` (public event, photos, upload), `admin*.ts` (behind
    `requireAuth`), `media.ts` (serves `${DATA_DIR}/media`).
  - Services: `uploadValidation` (magic bytes), `imageService` (sharp; HEIC via
    heic-convert first), `videoService` (ffmpeg → H.264 mp4 + poster), `exportService` (zip).
- `web/` (`@rtpa/web`): React + Vite + TanStack Query + Framer Motion.
  - `/` landing, `/e/:code` guest upload (`pages/UploadPage.tsx`),
    `/e/:code/display` live canvas (`pages/DisplayPage.tsx`), `/admin/*` console (`admin/`).
  - `display/rotationEngine.ts` is a **pure, deterministic** state machine (injectable
    rng and clock). `tick()` runs once a second: removes tiles past their leave grace,
    expires dwell, evicts the oldest non-priority tile when over cap or when a new
    upload is waiting, then admits the queue (new uploads) and cycles the album
    (priority first, then least-recently-shown). `placeTile` avoids covering newer tiles.
  - `display/renderer/CanvasRenderer.tsx` renders three nested layers per tile:
    enter/leave → glide loop (`motion.ts`) → static tilt. Tiles are memoized: re-creating
    the `animate` object each tick restarts the glide (a past bug).

## Data and storage

- SQLite at `${DATA_DIR}/rtpa.db` (WAL). Tables: settings (key/value), themes, events,
  photos. Only one event is active at a time; activating one pauses the others.
- Originals go in `${UPLOADS_DIR}/<eventId>/`; derived media in `${DATA_DIR}/media/{display,thumb}`.
- Uploads stream to `${UPLOADS_DIR}/.incoming` (multer disk storage) and are renamed into
  place. The folder is wiped at boot.
- Env: `PORT`, `DATA_DIR`, `UPLOADS_DIR`, `ADMIN_PASSWORD` (bootstrap only),
  `PUBLIC_BASE_URL` (seeds the admin setting; a value saved in admin wins),
  `SESSION_SECRET`, `WEB_DIR`. Dev defaults are `./.data` and `./.uploads`.

## Realtime contract

Room per event: `event:<code>`. Clients emit `join(code)`. The server emits
`photo:added|hidden|deleted|updated`, `settings:updated`, `theme:updated` and
`event:updated` (full `PublicEvent`, sent on pause/resume/end/activate and media-limit
changes). Un-hiding a photo re-sends `photo:added`.
- Always join through `joinEventRoom()` in `web/src/lib/socket.ts`. Rooms are lost on
  reconnect; the helper re-joins and calls a resync callback.
- The display reconciles a refetch with `syncAlbum()`. It never re-seeds, which would
  wipe the canvas.
- On shutdown the server calls `realtime.closeConnections()` (`io.engine.close()`).
  Don't use a server-side disconnect: clients won't auto-reconnect after one.

## Commands

```bash
npm ci && npm run build -w @rtpa/shared
npm run dev -w @rtpa/server          # API on :8080 (tsx watch)
npm run dev -w @rtpa/web             # Vite on :5173, proxies /api /media /socket.io
npm test -w @rtpa/shared|server|web  # vitest
npx tsc --noEmit -p server   # and -p web
```

**vitest does not typecheck**, so run `tsc` too: the web build (`tsc -b && vite build`)
and CI will catch type errors the tests miss.

## Testing conventions and gotchas

- Server tests build an app over `openMemoryDb()` + `migrate` + `seed`, with a fake
  `realtime` object. Any new `RealtimeEmitters` method must be added to `noopRealtime`
  (`app.ts`), `tests/helpers/testApp.ts`, and the inline fakes in
  `routes/__tests__/upload.test.ts` and `adminEventsBroadcast.test.ts`.
- Web tests that mock `lib/socket` must spread the real module
  (`async (importActual) => ({ ...(await importActual()), connectSocket: () => fake })`)
  so `joinEventRoom` still exists. The same applies to mocking `admin/api` when a
  component uses `ApiError`.
- `DisplayPage` tests stub framer-motion and use fake timers with `shouldAdvanceTime`.
- `PublicEvent` fixtures need `mediaLimits` (required field).
- The client sends **one upload request per file** (`UploadPage.handleFiles`). The server
  still accepts batches (all-or-nothing with rollback). Rate limits: 60 per minute per
  device+IP, and 600 per minute per IP (guests on venue Wi-Fi share one IP).
- Dockerfile copies `server/node_modules` on purpose (nanoid@5 is un-hoisted; see the comment).

## Deploy / CI

`.github/workflows/build-and-publish.yml` runs on pushes to `main`, tags `v*` and PRs.
The test job (shared, server and web tests, plus both builds) gates the docker job,
which publishes `ghcr.io/phlurblepoot/rtpartyalbum` (`latest` on main, plus a sha tag).

## History

- 2026-06: built from the plans on `build/mvp` (now merged into `main`; it is the only branch).
- 2026-10-27 review fixes:
  - Display/admin re-join after reconnect.
  - `PUBLIC_BASE_URL` honored; QR codes are always absolute.
  - Guest page uses admin media limits and warns when a video will be trimmed.
  - Live `event:updated` and theme-edit broadcasts.
  - 409 `theme_in_use` on deleting an in-use theme.
  - Disk-streamed, per-file uploads.
  - CI gates on all tests.
  - Clean shutdown with connected displays.

### Known gaps / ideas not done yet

- Admin photo list has no pagination; `/media` is public (but uses unguessable names).
- Upload page joins the event room, so guest phones also receive `photo:*` traffic.
  A guest-only room would trim that.
- Hidden photos' media URLs stay reachable if someone already has the link.
