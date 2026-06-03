# RTPartyAlbum — Design Spec

*Date: 2026-06-02 · Status: Approved design, ready for implementation planning*

## 1. Summary

RTPartyAlbum is a self-hosted web app for live party photo/video sharing. Guests scan a
QR code with their phone, land on a mobile upload page, and contribute photos and short
videos. Those media appear on a **live "gliding canvas"** display — a full-screen,
animated surface where photos sit scattered and slowly glide around, new ones flying in
and old ones gracefully rotating out. It is explicitly **not a slideshow**. An admin
console (separately password-protected) manages events, moderates the album, tunes the
canvas motion/animation/size behavior, and builds/selects themes.

The app is delivered as a **single Docker image** intended to run on an Unraid server
behind a reverse proxy.

## 2. Goals & non-goals

**Goals (v1)**
- Frictionless guest upload via QR — no app, no account.
- A beautiful, living animated display that feels alive, not like a slideshow.
- Deep admin control over how the canvas looks and moves.
- Reusable across many parties over time (one active event at a time).
- Simple self-hosting: one container, file-based storage, single admin password.

**Non-goals (deliberately deferred — data model leaves room)**
- Guest-facing gallery/browse page.
- Multi-admin accounts / roles.
- Multiple simultaneously-active events (concurrent multi-tenancy).
- Reactions / likes / comments.
- Built-in social sharing.

## 3. Key decisions (locked during brainstorming)

| Decision | Choice |
|----------|--------|
| Scale | Many events over time; **one active at a time** (reusable, create-per-event) |
| Hosting | Self-hosted **Docker on Unraid**, behind a user-managed reverse proxy |
| Guest access | **Public URL** via reverse proxy; `PUBLIC_BASE_URL` configurable in admin |
| Moderation | **Auto-show** (no approval queue); admin can instantly hide/delete anything |
| Attribution | Guest enters a **name** (shown). Device info captured **privately** (admin-only) |
| Media | **Photos + short videos** |
| Stack | **Node + React** (single image; SQLite; photos on a volume) |
| Admin auth | **Single admin password** |
| Display engine | **Approach A** — DOM + Framer Motion, real-time via Socket.IO (renderer kept modular) |
| Album export | **In v1** — admin downloads all media as a zip |

## 4. Architecture

**Single Docker image** running one Node/Express process that serves:
- the REST API,
- the built React front-end (Vite build, served statically), and
- a Socket.IO WebSocket server.

**Front-end:** React. The live display canvas uses **DOM elements animated with Framer
Motion / CSS transforms**. The renderer is isolated behind an interface so a
Canvas/WebGL (PixiJS) renderer could replace it later if huge photo counts are ever
needed — but v1 ships the DOM renderer only.

**Storage:**
- **SQLite** database file (no separate DB container).
- **Two mounted volumes**, both mapping to the Unraid array:
  - `/data` — SQLite db + generated thumbnails/derived media.
  - `/uploads` — original uploaded photos/videos.

**Real-time:** Socket.IO **room per event**. The server broadcasts media and settings
changes so every connected display (and the admin album view) updates instantly without
reloads.

**Configuration:**
- `ADMIN_PASSWORD` — env var (first-run/bootstrap); changeable in admin (hashed).
- `PUBLIC_BASE_URL` — env var **and** editable in admin; used to build QR codes and
  shareable upload links.
- Default media limits configurable in admin global settings.

## 5. Surfaces (routes)

| Surface | Route | Description |
|---------|-------|-------------|
| Guest Upload | `/e/:eventCode` | QR target. Mobile-first themed upload page. |
| Live Display | `/e/:eventCode/display` | Full-screen gliding canvas. No controls; auto-reconnect. |
| Admin Console | `/admin` | Password-gated management UI. |

## 6. Data model (SQLite)

**events**
- `id`, `code` (short URL slug), `name`, `created_at`
- `is_active` (only one true at a time), `upload_enabled`
- `status` (active / paused / ended)
- `theme_id` → themes
- `motion_config` (JSON — see §9 controls)

**photos** (covers photos and videos)
- `id`, `event_id`, `uploader_name`
- `file_path` (original), `display_path` (web-optimized), `thumb_path`
- `media_type` (`image` | `video`), `width`, `height`, `duration` (video)
- `created_at`, `is_hidden`
- **Private moderation fields (admin-only):** `device_id`, `user_agent`, `ip_address`

**themes**
- `id`, `name`, `is_preset` (bool)
- `tokens` (JSON — see §10)

**settings**
- key/value globals: `public_base_url`, `admin_password_hash`, default media limits.

## 7. Guest upload experience

- Mobile-first, themed to the event.
- Header: event name + a short friendly **"please be responsible"** note.
- **Name field**, remembered in `localStorage` so repeat uploads keep the name.
- Large **"Add photos / videos"** action → native camera or gallery; **multi-select**.
- **Client-side validation before upload:**
  - Type must be `image/*` or `video/*`.
  - Default caps (admin-configurable): **photo ≤ ~25 MB**; **video ≤ ~60 MB and ≤ 30 s**.
  - Images downscaled in-browser before upload to keep it fast on party wifi/cell.
- **Per-file upload progress**; success state ("✅ added to the party!") with a thumbnail
  strip of the guest's own contributions.
- Silently captures **device_id** (UUID in `localStorage`), **user_agent**, and
  server-side **IP** — never shown to guests.
- If `upload_enabled` is off, shows a polite "uploads are closed" state.

## 8. Live display canvas

**Rotation model**
- The full album may hold far more photos than the canvas shows.
- The canvas shows up to **Max-on-canvas** tiles at once — a **hard cap, never exceeded**
  (no popping in over the limit).
- A tile **leaves** when either: its **dwell time** expires (if dwell-timeout is enabled),
  or it is the longest-standing tile and something is waiting to enter. Leaving frees a
  **slot**.
- When a slot frees, the next photo **enters** it:
  - **New uploads get priority.** If the canvas is full when a guest uploads, the engine
    **gracefully cycles out** the oldest tile (rotation, with a leave animation), and the
    new photo flies into the freed slot within a few seconds.
  - When no new uploads are waiting, the engine keeps the canvas full by **cycling through
    the rest of the album**, so over time the whole album gets screen time.
- **Dwell-timeout is an admin option:** on (duration + variance so tiles don't all leave at
  once) or off (rotation driven purely by the cap + new uploads).

**Tile rendering**
- Each tile is a photo, or a **muted looping `<video>`** for video media.
- Themed frame + optional **uploader-name caption** (the only public attribution).
- Each tile is assigned a **motion behavior** (Drift / Current / Orbit / Mosaic) by the
  admin's weights, plus a **size** derived from base-size + variance.

**Enter / leave animations ("cute animations")**
- **Enter set:** fly-in-from-edge, scale-pop, fade-grow, spin-in, drop-&-bounce.
- **Leave set:** drift-off-edge, shrink-fade, spin-out, slide-away.
- Each tile picks one per **admin frequency weights** (same weighting mechanism as motion
  styles).

**Live updates & accessibility**
- Admin setting changes (theme, weights, speed, size, count, dwell) apply **live** to the
  display without a reload, via Socket.IO.
- Respects `prefers-reduced-motion` with a gentle fallback.

## 9. Admin canvas controls (per event, live-applied)

- **Motion-style mix** — weights for Drift / Current / Orbit / Mosaic.
- **Overall motion speed.**
- **Max-on-canvas** (hard cap).
- **Dwell timeout** — on/off + duration + variance.
- **Enter-animation frequency weights.**
- **Leave-animation frequency weights.**
- **Base photo size** (overall tile scale).
- **Size variance** (uniform → widely mixed).

All persisted in `events.motion_config` (JSON).

## 10. Theming system

A **Theme** is a JSON token set:
- **Background** — solid / gradient / image.
- **Ambient effect** — none / bokeh / particles / glow.
- **Frame style** — border width & color, polaroid, rounded, shadow.
- **Caption style** — uploader-name pill appearance.
- **Font** and **accent color**.

**Presets (seeded):** Midnight Gala (default), Warm Bokeh, Neon Night, Clean Light,
Rustic Kraft, Garden Pastel, Monochrome Film, Confetti Pop, Starfield.

**Custom theme builder (admin):** live preview; edit every token; **save as a named
theme**; reuse across events. Any preset can be **duplicated → customized**. Theme is
selected per event.

## 11. Admin console

**Events**
- List with status (active / paused / ended), photo count, created date.
- **Create event:** name → auto-generated short `code`; set active (activating one pauses
  others — only one active at a time).
- Per event: downloadable/printable **QR code** (from `PUBLIC_BASE_URL` + code), shareable
  upload link, **pause/resume uploads**, **end event**.

**Album manager**
- Open any event → **grid of all photos, newest-first**, live-updating via WebSocket as
  guests upload.
- Each tile: thumbnail, **uploader name**, timestamp, and **private device info**
  (device_id / user-agent / IP) in a detail/hover.
- **Hide** (remove from canvas, keep file) or **Delete** (remove file) on any photo —
  reflected on the live display instantly.
- Bulk select for hide/delete; filter to hidden.

**Album export (v1)**
- **Download album** per event → streamed **zip** of all originals (photos + videos) plus
  a manifest (uploader name + timestamp). Streamed to handle large albums.

**Display settings** — all §9 canvas controls (live-applied) + **"Open display"** button
to launch the full-screen canvas on the party screen.

**Theme builder** — §10.

**Global settings** — `PUBLIC_BASE_URL`, change admin password, default media limits.

## 12. Media & real-time pipeline

- Upload → Express (Multer) streams to `/uploads`.
  - **Images:** `sharp` produces a web-optimized display version + thumbnail; normalizes
    HEIC → JPEG; strips metadata except orientation.
  - **Videos:** `ffmpeg` produces a poster thumbnail + a normalized/length-capped MP4;
    size/length validated server-side.
- Metadata row written to SQLite.
- **Socket.IO broadcasts** keep everything in sync within the event room:
  - `photo:added`, `photo:hidden`, `photo:deleted`, `settings:updated`, `theme:updated`.

## 13. Security & privacy

- Admin password **hashed (bcrypt)**; **httpOnly** session cookie; login **rate-limited**.
- Upload endpoint **rate-limited** per device_id/IP; strict MIME/type validation;
  randomized stored filenames; served images have metadata stripped (except orientation).
- **Device info is admin-only** — never exposed to guests or shown on the display. The
  guest-entered **name** is the only public attribution.
- "Be responsible" note on the upload page; admin can instantly pull anything down.

## 14. Deployment (Unraid)

- Single Docker image; environment: `ADMIN_PASSWORD`, `PUBLIC_BASE_URL`.
- Volumes: `/data` (SQLite + derived media), `/uploads` (originals) → Unraid array shares.
- Reverse proxy (user-managed: NPM / SWAG / Cloudflare Tunnel) terminates TLS and exposes
  the public URL used by QR codes.

## 15. Open defaults (sensible starting values, tunable later)

- Default theme: **Midnight Gala**.
- Default canvas: motion mix weighted toward **Drift**, moderate speed, **Max-on-canvas ≈
  24**, dwell timeout **on** (~45 s ± variance), balanced enter/leave animation weights,
  medium base size, moderate variance.
- Default media caps: photo ≤ 25 MB; video ≤ 60 MB & ≤ 30 s.
