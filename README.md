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
