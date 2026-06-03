# RTPartyAlbum — Plan 4: Guest Upload Front-end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the shared `@rtpa/web` React app skeleton (consumed by Plans 5 & 6) and build the mobile-first guest **Upload page** at `/e/:code`: load the `PublicEvent`, apply its theme, capture an uploader name, validate + in-browser downscale selected media, and upload with per-file progress to `POST /api/events/by-code/:code/upload`, ending in a success state with a thumbnail strip of the guest's own contributions.

**Architecture:** Plans 1–3 are implemented, so the server API is complete. The Vite dev server proxies `/api`, `/socket.io`, and `/media` to `http://localhost:8080`. React Router renders `UploadPage` (this plan), with placeholder routes for `DisplayPage` (Plan 6) and `Admin` (Plan 5). Data fetching uses `@tanstack/react-query`. A typed `client.ts` wraps `fetch` for reads and `XMLHttpRequest` for the multipart upload (so per-file progress is observable). Theme tokens (`ThemeTokens` from `@rtpa/shared`) map to CSS custom properties applied to the page root. Pure utilities (`deviceId`, `themeCss`, `useUploaderName`, `downscaleImage`, `validateUpload`) are unit-tested in isolation; `UploadPage` is tested with `@testing-library/react` against a mocked `api/client`.

**Tech Stack:** React ^18.3, Vite ^5, `@vitejs/plugin-react`, react-router-dom ^6.26, framer-motion ^11, `@tanstack/react-query` ^5, socket.io-client ^4.7. Tests: Vitest ^2 (jsdom), `@testing-library/react` ^16, `@testing-library/jest-dom`, `@testing-library/user-event`. TypeScript ^5.4, ESM. All shared types imported from `@rtpa/shared`.

> **Conventions for every task below**
> - TDD loop per step: write/extend the **failing test** → run `npm test -w @rtpa/web -- <file>` and confirm **FAIL** → write the **COMPLETE** implementation → run the same command and confirm **PASS** → `git commit`.
> - Run a single file with `npm test -w @rtpa/web -- <relativePathFromWeb>` (Vitest treats the trailing arg as a filename filter).
> - No placeholders in committed code. Browser APIs not present in jsdom (`Image`, `HTMLCanvasElement.toBlob`, `XMLHttpRequest`, `crypto.randomUUID`, `URL.createObjectURL`) are explicitly mocked in tests as shown.

---

### Task 1 — Web app scaffold (`@rtpa/web`)

**Files:**
- `web/package.json`
- `web/vite.config.ts`
- `web/tsconfig.json`
- `web/index.html`
- `web/vitest.config.ts`
- `web/src/test/setup.ts`
- `web/src/main.tsx`
- `web/src/router.tsx`
- `web/src/pages/UploadPage.tsx` (stub this task; built fully in Task 8)
- `web/src/pages/DisplayPage.tsx` (placeholder for Plan 6)
- `web/src/admin/AdminApp.tsx` (placeholder for Plan 5)
- `web/src/router.test.tsx`

Steps:

- [ ] Create `web/package.json` with exact contents:

```json
{
  "name": "@rtpa/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@rtpa/shared": "*",
    "@tanstack/react-query": "^5.51.0",
    "framer-motion": "^11.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "socket.io-client": "^4.7.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.6",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.1.0",
    "typescript": "^5.4.5",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] Create `web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PROXY_TARGET = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: PROXY_TARGET, changeOrigin: true },
      '/media': { target: PROXY_TARGET, changeOrigin: true },
      '/socket.io': { target: PROXY_TARGET, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [ ] Create `web/tsconfig.json` (references `@rtpa/shared`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"],
  "references": [{ "path": "../shared" }]
}
```

- [ ] Create `web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>RTPartyAlbum</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] Create `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
```

- [ ] Create `web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
```

- [ ] Create placeholder `web/src/pages/DisplayPage.tsx`:

```tsx
export default function DisplayPage() {
  return <div data-testid="display-placeholder">Display coming soon</div>;
}
```

- [ ] Create placeholder `web/src/admin/AdminApp.tsx`:

```tsx
export default function AdminApp() {
  return <div data-testid="admin-placeholder">Admin coming soon</div>;
}
```

- [ ] Create a temporary stub `web/src/pages/UploadPage.tsx` (replaced wholesale in Task 8) so the router compiles:

```tsx
import { useParams } from 'react-router-dom';

export default function UploadPage() {
  const { code } = useParams<{ code: string }>();
  return <div data-testid="upload-page">Upload page for {code}</div>;
}
```

- [ ] Create `web/src/router.tsx`:

```tsx
import { createBrowserRouter } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import DisplayPage from './pages/DisplayPage';
import AdminApp from './admin/AdminApp';

export const router = createBrowserRouter([
  { path: '/e/:code', element: <UploadPage /> },
  { path: '/e/:code/display', element: <DisplayPage /> },
  { path: '/admin/*', element: <AdminApp /> },
  { path: '*', element: <div>Not found</div> },
]);
```

- [ ] Create `web/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] Write the failing smoke test `web/src/router.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import DisplayPage from './pages/DisplayPage';
import AdminApp from './admin/AdminApp';

const routes = [
  { path: '/e/:code', element: <UploadPage /> },
  { path: '/e/:code/display', element: <DisplayPage /> },
  { path: '/admin/*', element: <AdminApp /> },
];

describe('router', () => {
  it('renders the UploadPage for /e/:code', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/e/PARTY1'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('upload-page')).toHaveTextContent('PARTY1');
  });

  it('renders the DisplayPage placeholder for /e/:code/display', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/e/PARTY1/display'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('display-placeholder')).toBeInTheDocument();
  });

  it('renders the Admin placeholder for /admin', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/admin'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('admin-placeholder')).toBeInTheDocument();
  });
});
```

- [ ] Run `npm install` at the repo root to link the new workspace, then `npm test -w @rtpa/web -- router.test.tsx` → expect **FAIL** (until deps install / files exist), then make it **PASS**.

- [ ] Create the shared Socket.IO client singleton `web/src/lib/socket.ts`. The guest Upload page does not use it, but it is part of the shared web skeleton and is imported by the admin console (Plan 5) and the live display (Plan 6). It exports **both** `connectSocket()` and `getSocket()` (aliases) so either consumer's import resolves:

```ts
import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@rtpa/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/**
 * Returns the shared singleton socket, creating + connecting it on first call.
 * Same-origin: Vite proxies `/socket.io` to the server in dev; in production the
 * server hosts both the SPA and the websocket on one origin.
 */
export function connectSocket(): AppSocket {
  if (!socket) {
    socket = io({ autoConnect: true, transports: ['websocket', 'polling'] });
  }
  return socket;
}

/** Returns the singleton socket, connecting it if it does not exist yet. */
export function getSocket(): AppSocket {
  return connectSocket();
}

/** Test/HMR helper — drops the singleton so the next call reconnects fresh. */
export function resetSocket(): void {
  socket?.close();
  socket = null;
}
```

- [ ] `git commit -m "feat(web): scaffold @rtpa/web app skeleton + shared socket client, with router smoke test"`

---

### Task 2 — Typed API client (`src/api/client.ts`, `src/api/types.ts`)

**Files:**
- `web/src/api/types.ts`
- `web/src/api/client.ts`
- `web/src/api/client.test.ts`

Steps:

- [ ] Create `web/src/api/types.ts` (re-export contract types):

```ts
export type {
  PublicEvent,
  Photo,
  Theme,
  ThemeTokens,
  MotionConfig,
  MediaLimits,
  MediaType,
  EventStatus,
} from '@rtpa/shared';
```

- [ ] Write failing tests `web/src/api/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PublicEvent, Photo } from './types';
import { getPublicEvent, getPublicPhotos, uploadFiles } from './client';

const fakeEvent: PublicEvent = {
  code: 'PARTY1',
  name: 'Sam & Lee',
  status: 'active',
  uploadEnabled: true,
  theme: {
    id: 'preset-midnight-gala',
    name: 'Midnight Gala',
    isPreset: true,
    tokens: {
      background: { type: 'solid', value: '#10131c' },
      ambient: 'none',
      frame: { style: 'thin', borderColor: '#fff', borderWidth: 2, radius: 8, shadow: true },
      caption: { enabled: true, bg: '#000', color: '#fff' },
      font: 'Inter, sans-serif',
      accent: '#c9a227',
    },
  },
  motionConfig: {
    motionWeights: { drift: 5, current: 2, orbit: 1, mosaic: 2 },
    speed: 1,
    maxOnCanvas: 24,
    dwell: { enabled: true, durationMs: 45000, varianceMs: 15000 },
    enterWeights: { flyInEdge: 3, scalePop: 2, fadeGrow: 2, spinIn: 1, dropBounce: 2 },
    leaveWeights: { driftOffEdge: 3, shrinkFade: 3, spinOut: 1, slideAway: 2 },
    baseSize: 220,
    sizeVariance: 0.4,
  },
};

describe('getPublicEvent', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(fakeEvent), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('fetches the by-code endpoint and returns the parsed event', async () => {
    const result = await getPublicEvent('PARTY1');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/events/by-code/PARTY1', expect.any(Object));
    expect(result).toEqual(fakeEvent);
  });

  it('throws with the status when the event is missing (404)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    await expect(getPublicEvent('NOPE')).rejects.toMatchObject({ status: 404 });
  });

  it('URL-encodes the code', async () => {
    await getPublicEvent('a b');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/events/by-code/a%20b', expect.any(Object));
  });
});

describe('getPublicPhotos', () => {
  it('fetches the photos endpoint and returns the array', async () => {
    const photos: Photo[] = [];
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(photos), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch;
    const result = await getPublicPhotos('PARTY1');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/events/by-code/PARTY1/photos', expect.any(Object));
    expect(result).toEqual(photos);
  });
});

describe('uploadFiles', () => {
  class MockXHR {
    static instances: MockXHR[] = [];
    upload = { onprogress: null as null | ((e: ProgressEvent) => void) };
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    status = 0;
    responseText = '';
    method = '';
    url = '';
    sentBody: FormData | null = null;
    constructor() {
      MockXHR.instances.push(this);
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    send(body: FormData) {
      this.sentBody = body;
    }
  }

  beforeEach(() => {
    MockXHR.instances = [];
    // @ts-expect-error overriding for test
    globalThis.XMLHttpRequest = MockXHR;
  });
  afterEach(() => vi.restoreAllMocks());

  it('POSTs multipart to the upload endpoint with name, deviceId, and files; reports progress; resolves photos', async () => {
    const onProgress = vi.fn();
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const responsePhotos: Photo[] = [];

    const promise = uploadFiles('PARTY1', {
      uploaderName: 'Robin',
      deviceId: 'dev-123',
      files: [file],
      onProgress,
    });

    const xhr = MockXHR.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/events/by-code/PARTY1/upload');
    expect(xhr.sentBody?.get('uploaderName')).toBe('Robin');
    expect(xhr.sentBody?.get('deviceId')).toBe('dev-123');
    expect(xhr.sentBody?.getAll('files')).toHaveLength(1);

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith(0.5);

    xhr.status = 200;
    xhr.responseText = JSON.stringify(responsePhotos);
    xhr.onload?.();

    await expect(promise).resolves.toEqual(responsePhotos);
  });

  it('rejects with status on a non-2xx response', async () => {
    const promise = uploadFiles('PARTY1', {
      uploaderName: 'Robin',
      deviceId: 'dev-123',
      files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
    });
    const xhr = MockXHR.instances[0];
    xhr.status = 403;
    xhr.responseText = 'uploads closed';
    xhr.onload?.();
    await expect(promise).rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] Run `npm test -w @rtpa/web -- client.test.ts` → expect **FAIL**.
- [ ] Create `web/src/api/client.ts`:

```ts
import type { PublicEvent, Photo } from './types';

export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`API error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new ApiError(res.status, await res.text().catch(() => ''));
  }
  return (await res.json()) as T;
}

export function getPublicEvent(code: string): Promise<PublicEvent> {
  return getJson<PublicEvent>(`/api/events/by-code/${encodeURIComponent(code)}`);
}

export function getPublicPhotos(code: string): Promise<Photo[]> {
  return getJson<Photo[]>(`/api/events/by-code/${encodeURIComponent(code)}/photos`);
}

export interface UploadArgs {
  uploaderName: string;
  deviceId: string;
  files: File[];
  onProgress?: (fraction: number) => void;
}

export function uploadFiles(code: string, args: UploadArgs): Promise<Photo[]> {
  const { uploaderName, deviceId, files, onProgress } = args;
  return new Promise<Photo[]>((resolve, reject) => {
    const form = new FormData();
    form.append('uploaderName', uploaderName);
    form.append('deviceId', deviceId);
    for (const file of files) {
      form.append('files', file, file.name);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/events/by-code/${encodeURIComponent(code)}/upload`);

    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Photo[]);
        } catch (err) {
          reject(new ApiError(xhr.status, xhr.responseText));
        }
      } else {
        reject(new ApiError(xhr.status, xhr.responseText));
      }
    };

    xhr.onerror = () => reject(new ApiError(0, 'network error'));

    xhr.send(form);
  });
}
```

- [ ] Run `npm test -w @rtpa/web -- client.test.ts` → expect **PASS**.
- [ ] `git commit -m "feat(web): typed api client for public event/photos/upload with progress"`

---

### Task 3 — Device id util (`src/lib/deviceId.ts`)

**Files:**
- `web/src/lib/deviceId.ts`
- `web/src/lib/deviceId.test.ts`

Steps:

- [ ] Write failing tests `web/src/lib/deviceId.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDeviceId, DEVICE_ID_KEY } from './deviceId';

describe('getDeviceId', () => {
  beforeEach(() => {
    localStorage.clear();
    let counter = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(
      () => `uuid-${++counter}` as `${string}-${string}-${string}-${string}-${string}`,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('generates and persists a uuid under the rtpa_device_id key', () => {
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull();
    const id = getDeviceId();
    expect(id).toBe('uuid-1');
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe('uuid-1');
  });

  it('returns the same id on subsequent calls (stable)', () => {
    const first = getDeviceId();
    const second = getDeviceId();
    expect(second).toBe(first);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing stored id', () => {
    localStorage.setItem(DEVICE_ID_KEY, 'preexisting');
    expect(getDeviceId()).toBe('preexisting');
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
});
```

- [ ] Run `npm test -w @rtpa/web -- deviceId.test.ts` → expect **FAIL**.
- [ ] Create `web/src/lib/deviceId.ts`:

```ts
export const DEVICE_ID_KEY = 'rtpa_device_id';

export function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}
```

- [ ] Run `npm test -w @rtpa/web -- deviceId.test.ts` → expect **PASS**.
- [ ] `git commit -m "feat(web): persistent deviceId util backed by localStorage"`

---

### Task 4 — Theme → CSS vars util (`src/lib/themeCss.ts`)

**Files:**
- `web/src/lib/themeCss.ts`
- `web/src/lib/themeCss.test.ts`

Steps:

- [ ] Write failing tests `web/src/lib/themeCss.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ThemeTokens } from '../api/types';
import { themeToCssVars, themeVars, backgroundStyle, frameStyle } from './themeCss';

function tokens(overrides: Partial<ThemeTokens> = {}): ThemeTokens {
  return {
    background: { type: 'solid', value: '#10131c' },
    ambient: 'none',
    frame: { style: 'polaroid', borderColor: '#ffffff', borderWidth: 6, radius: 4, shadow: true },
    caption: { enabled: true, bg: 'rgba(0,0,0,0.6)', color: '#fff' },
    font: 'Inter, sans-serif',
    accent: '#c9a227',
    ...overrides,
  };
}

describe('themeToCssVars', () => {
  it('maps accent, font, frame, and caption tokens to CSS custom properties', () => {
    const vars = themeToCssVars(tokens());
    expect(vars['--rtpa-accent']).toBe('#c9a227');
    expect(vars['--rtpa-font']).toBe('Inter, sans-serif');
    expect(vars['--rtpa-frame-border-color']).toBe('#ffffff');
    expect(vars['--rtpa-frame-border-width']).toBe('6px');
    expect(vars['--rtpa-frame-radius']).toBe('4px');
    expect(vars['--rtpa-frame-shadow']).toBe('0 6px 24px rgba(0,0,0,0.35)');
    expect(vars['--rtpa-caption-bg']).toBe('rgba(0,0,0,0.6)');
    expect(vars['--rtpa-caption-color']).toBe('#fff');
  });

  it('emits no shadow when frame.shadow is false', () => {
    const vars = themeToCssVars(tokens({ frame: { style: 'thin', borderColor: '#000', borderWidth: 1, radius: 2, shadow: false } }));
    expect(vars['--rtpa-frame-shadow']).toBe('none');
  });
});

describe('backgroundStyle', () => {
  it('solid background sets backgroundColor', () => {
    const style = backgroundStyle(tokens({ background: { type: 'solid', value: '#222' } }));
    expect(style.background).toBe('#222');
  });

  it('gradient background uses the raw value as background', () => {
    const value = 'linear-gradient(135deg, #1a2a6c, #b21f1f)';
    const style = backgroundStyle(tokens({ background: { type: 'gradient', value } }));
    expect(style.background).toBe(value);
  });

  it('image background sets a cover background-image url', () => {
    const style = backgroundStyle(tokens({ background: { type: 'image', value: '/media/bg.jpg' } }));
    expect(style.backgroundImage).toBe('url("/media/bg.jpg")');
    expect(style.backgroundSize).toBe('cover');
    expect(style.backgroundPosition).toBe('center');
  });
});

// `themeVars` is the name the admin console (Plan 5) imports; it is an alias of
// `themeToCssVars`. `frameStyle` returns a concrete tile-frame style object (used by
// the theme-builder live preview in Plan 5 and the display Tile in Plan 6).
describe('themeVars (alias) and frameStyle', () => {
  it('themeVars is identical to themeToCssVars', () => {
    expect(themeVars(tokens())).toEqual(themeToCssVars(tokens()));
  });

  it('frameStyle maps border tokens to a concrete style', () => {
    const style = frameStyle(tokens({ frame: { style: 'thin', borderColor: '#abcdef', borderWidth: 3, radius: 8, shadow: false } }));
    expect(style.borderColor).toBe('#abcdef');
    expect(style.borderWidth).toBe(3);
    expect(style.borderRadius).toBe(8);
    expect(style.boxShadow).toBe('none');
  });

  it('frameStyle "none" removes border and shadow', () => {
    const style = frameStyle(tokens({ frame: { style: 'none', borderColor: '#000', borderWidth: 0, radius: 0, shadow: false } }));
    expect(style.border).toBe('none');
    expect(style.boxShadow).toBe('none');
  });

  it('frameStyle "polaroid" thickens the bottom border', () => {
    const style = frameStyle(tokens({ frame: { style: 'polaroid', borderColor: '#fff', borderWidth: 6, radius: 4, shadow: true } }));
    expect(style.borderBottomWidth).toBe(16);
  });
});
```

- [ ] Run `npm test -w @rtpa/web -- themeCss.test.ts` → expect **FAIL**.
- [ ] Create `web/src/lib/themeCss.ts`:

```ts
import type { CSSProperties } from 'react';
import type { ThemeTokens } from '../api/types';

export function themeToCssVars(tokens: ThemeTokens): CSSProperties {
  const { frame, caption } = tokens;
  const vars: Record<string, string> = {
    '--rtpa-accent': tokens.accent,
    '--rtpa-font': tokens.font,
    '--rtpa-frame-style': frame.style,
    '--rtpa-frame-border-color': frame.borderColor,
    '--rtpa-frame-border-width': `${frame.borderWidth}px`,
    '--rtpa-frame-radius': `${frame.radius}px`,
    '--rtpa-frame-shadow': frame.shadow ? '0 6px 24px rgba(0,0,0,0.35)' : 'none',
    '--rtpa-caption-bg': caption.bg,
    '--rtpa-caption-color': caption.color,
  };
  return vars as CSSProperties;
}

export function backgroundStyle(tokens: ThemeTokens): CSSProperties {
  const { background } = tokens;
  if (background.type === 'image') {
    return {
      backgroundImage: `url("${background.value}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  // solid and gradient both map directly to the `background` shorthand
  return { background: background.value };
}

/**
 * Alias consumed by the admin console (Plan 5). Identical to `themeToCssVars` —
 * emits the theme's CSS custom properties (including `--rtpa-accent`).
 */
export const themeVars = themeToCssVars;

/**
 * Concrete frame style for a single tile/figure, derived from the theme's frame
 * tokens. Used by the Plan 5 theme-builder preview and the Plan 6 display Tile.
 */
export function frameStyle(tokens: ThemeTokens): CSSProperties {
  const { frame } = tokens;
  if (frame.style === 'none') {
    return { border: 'none', borderRadius: 0, boxShadow: 'none' };
  }
  const base: CSSProperties = {
    borderStyle: 'solid',
    borderColor: frame.borderColor,
    borderWidth: frame.borderWidth,
    borderRadius: frame.radius,
    boxShadow: frame.shadow ? '0 6px 24px rgba(0,0,0,0.35)' : 'none',
    background: '#fff',
  };
  if (frame.style === 'polaroid') {
    // Polaroid look: thick bottom edge, minimal corner rounding.
    return { ...base, borderBottomWidth: Math.max(frame.borderWidth, 16), borderRadius: 2 };
  }
  // 'thin' and 'rounded' are expressed purely through the borderWidth/radius tokens.
  return base;
}
```

- [ ] Run `npm test -w @rtpa/web -- themeCss.test.ts` → expect **PASS**.
- [ ] `git commit -m "feat(web): themeToCssVars/themeVars, backgroundStyle, and frameStyle helpers"`

---

### Task 5 — Uploader-name persistence hook (`src/lib/useUploaderName.ts`)

**Files:**
- `web/src/lib/useUploaderName.ts`
- `web/src/lib/useUploaderName.test.tsx`

Steps:

- [ ] Write failing tests `web/src/lib/useUploaderName.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUploaderName, UPLOADER_NAME_KEY } from './useUploaderName';

describe('useUploaderName', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useUploaderName());
    expect(result.current.name).toBe('');
  });

  it('hydrates from localStorage', () => {
    localStorage.setItem(UPLOADER_NAME_KEY, 'Robin');
    const { result } = renderHook(() => useUploaderName());
    expect(result.current.name).toBe('Robin');
  });

  it('setName updates state and persists to localStorage', () => {
    const { result } = renderHook(() => useUploaderName());
    act(() => result.current.setName('Sam'));
    expect(result.current.name).toBe('Sam');
    expect(localStorage.getItem(UPLOADER_NAME_KEY)).toBe('Sam');
  });
});
```

- [ ] Run `npm test -w @rtpa/web -- useUploaderName.test.tsx` → expect **FAIL**.
- [ ] Create `web/src/lib/useUploaderName.ts`:

```ts
import { useCallback, useState } from 'react';

export const UPLOADER_NAME_KEY = 'rtpa_uploader_name';

export function getStoredName(): string {
  return localStorage.getItem(UPLOADER_NAME_KEY) ?? '';
}

export function useUploaderName(): { name: string; setName: (next: string) => void } {
  const [name, setNameState] = useState<string>(() => getStoredName());

  const setName = useCallback((next: string) => {
    setNameState(next);
    localStorage.setItem(UPLOADER_NAME_KEY, next);
  }, []);

  return { name, setName };
}
```

- [ ] Run `npm test -w @rtpa/web -- useUploaderName.test.tsx` → expect **PASS**.
- [ ] `git commit -m "feat(web): useUploaderName hook persisting name in localStorage"`

---

### Task 6 — In-browser image downscale (`src/lib/downscaleImage.ts`)

**Files:**
- `web/src/lib/downscaleImage.ts`
- `web/src/lib/downscaleImage.test.ts`

Steps:

- [ ] Write failing tests `web/src/lib/downscaleImage.test.ts`. The test mocks `Image`, `URL.createObjectURL`/`revokeObjectURL`, and `HTMLCanvasElement.prototype.getContext`/`toBlob`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downscaleImage } from './downscaleImage';

class MockImage {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  width = 0;
  height = 0;
  private _src = '';
  set src(_value: string) {
    this._src = _value;
    // simulate async decode resolving with the dimensions assigned by the test
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this._src;
  }
}

let nextImageDims = { width: 0, height: 0 };

beforeEach(() => {
  // @ts-expect-error test override
  globalThis.Image = function () {
    const img = new MockImage();
    img.width = nextImageDims.width;
    img.height = nextImageDims.height;
    return img;
  };
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);

  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    cb(new Blob(['resized'], { type: 'image/jpeg' }));
  });
});

afterEach(() => vi.restoreAllMocks());

describe('downscaleImage', () => {
  it('passes videos through unchanged', async () => {
    const video = new File(['v'], 'clip.mp4', { type: 'video/mp4' });
    const out = await downscaleImage(video);
    expect(out).toBe(video);
  });

  it('passes non-image/non-video files through unchanged', async () => {
    const other = new File(['x'], 'note.txt', { type: 'text/plain' });
    const out = await downscaleImage(other);
    expect(out).toBe(other);
  });

  it('passes small images through unchanged (longest edge <= maxEdge)', async () => {
    nextImageDims = { width: 800, height: 600 };
    const img = new File(['i'], 'small.jpg', { type: 'image/jpeg' });
    const out = await downscaleImage(img, 1600, 0.85);
    expect(out).toBe(img);
  });

  it('resizes large images and returns a new jpeg File preserving the basename', async () => {
    nextImageDims = { width: 4000, height: 3000 };
    const img = new File(['i'], 'big.heic', { type: 'image/heic' });
    const out = await downscaleImage(img, 1600, 0.85);
    expect(out).not.toBe(img);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('big.jpg');
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
```

- [ ] Run `npm test -w @rtpa/web -- downscaleImage.test.ts` → expect **FAIL**.
- [ ] Create `web/src/lib/downscaleImage.ts`:

```ts
function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

function jpegName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot === -1 ? name : name.slice(0, dot);
  return `${base}.jpg`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = url;
  });
}

/**
 * Downscale an image File so its longest edge is <= maxEdge, re-encoding as JPEG.
 * Videos, non-images, and already-small images are returned unchanged.
 */
export async function downscaleImage(
  file: File,
  maxEdge = 1600,
  quality = 0.85,
): Promise<File> {
  if (!isImage(file)) return file;

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const longest = Math.max(img.width, img.height);
    if (longest <= maxEdge) return file;

    const scale = maxEdge / longest;
    const targetW = Math.round(img.width * scale);
    const targetH = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (!blob) return file;

    return new File([blob], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] Run `npm test -w @rtpa/web -- downscaleImage.test.ts` → expect **PASS**.
- [ ] `git commit -m "feat(web): in-browser image downscale via canvas with passthroughs"`

---

### Task 7 — Client-side upload validation (`src/lib/validateUpload.ts`)

**Files:**
- `web/src/lib/validateUpload.ts`
- `web/src/lib/validateUpload.test.ts`

Steps:

- [ ] Write failing tests `web/src/lib/validateUpload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { MediaLimits } from '../api/types';
import { validateFiles } from './validateUpload';

const limits: MediaLimits = {
  photoMaxBytes: 25 * 1024 * 1024,
  videoMaxBytes: 60 * 1024 * 1024,
  videoMaxDurationSec: 30,
};

function fileOfSize(name: string, type: string, bytes: number): File {
  const f = new File([new Uint8Array(0)], name, { type });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

describe('validateFiles', () => {
  it('accepts an image at the exact photo size cap', () => {
    const f = fileOfSize('a.jpg', 'image/jpeg', limits.photoMaxBytes);
    const { accepted, rejected } = validateFiles([f], limits);
    expect(accepted).toEqual([f]);
    expect(rejected).toEqual([]);
  });

  it('rejects an image one byte over the photo cap with reason "too-large"', () => {
    const f = fileOfSize('a.jpg', 'image/jpeg', limits.photoMaxBytes + 1);
    const { accepted, rejected } = validateFiles([f], limits);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ file: f, reason: 'too-large' }]);
  });

  it('accepts a video at the exact video size cap', () => {
    const f = fileOfSize('v.mp4', 'video/mp4', limits.videoMaxBytes);
    const { accepted } = validateFiles([f], limits);
    expect(accepted).toEqual([f]);
  });

  it('rejects a video over the video cap', () => {
    const f = fileOfSize('v.mp4', 'video/mp4', limits.videoMaxBytes + 1);
    const { rejected } = validateFiles([f], limits);
    expect(rejected).toEqual([{ file: f, reason: 'too-large' }]);
  });

  it('rejects unsupported types with reason "bad-type"', () => {
    const f = fileOfSize('note.pdf', 'application/pdf', 10);
    const { accepted, rejected } = validateFiles([f], limits);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ file: f, reason: 'bad-type' }]);
  });

  it('partitions a mixed batch', () => {
    const ok = fileOfSize('ok.jpg', 'image/jpeg', 1000);
    const big = fileOfSize('big.jpg', 'image/jpeg', limits.photoMaxBytes + 1);
    const bad = fileOfSize('x.txt', 'text/plain', 5);
    const { accepted, rejected } = validateFiles([ok, big, bad], limits);
    expect(accepted).toEqual([ok]);
    expect(rejected).toEqual([
      { file: big, reason: 'too-large' },
      { file: bad, reason: 'bad-type' },
    ]);
  });
});
```

- [ ] Run `npm test -w @rtpa/web -- validateUpload.test.ts` → expect **FAIL**.
- [ ] Create `web/src/lib/validateUpload.ts`:

```ts
import type { MediaLimits } from '../api/types';

export type RejectReason = 'bad-type' | 'too-large';

export interface RejectedFile {
  file: File;
  reason: RejectReason;
}

export interface ValidationResult {
  accepted: File[];
  rejected: RejectedFile[];
}

export function validateFiles(files: File[], limits: MediaLimits): ValidationResult {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of files) {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      rejected.push({ file, reason: 'bad-type' });
      continue;
    }

    const cap = isImage ? limits.photoMaxBytes : limits.videoMaxBytes;
    if (file.size > cap) {
      rejected.push({ file, reason: 'too-large' });
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejected };
}
```

> Note: video duration cannot be reliably measured before upload across all browsers/codecs; `videoMaxDurationSec` is enforced server-side per the spec (§12). Client validation covers type and size only.

- [ ] Run `npm test -w @rtpa/web -- validateUpload.test.ts` → expect **PASS**.
- [ ] `git commit -m "feat(web): client-side upload type/size validation"`

---

### Task 8 — UploadPage (`src/pages/UploadPage.tsx`)

**Files:**
- `web/src/pages/UploadPage.tsx` (replaces the Task 1 stub)
- `web/src/pages/UploadPage.css` (created in Task 9; imported here)
- `web/src/pages/UploadPage.test.tsx`

This page composes everything: react-query load of the `PublicEvent`, theme application, name input, file picker, validate → downscale → upload pipeline with per-file progress, success strip, rejected-file toasts, closed/loading/404 states.

Steps:

- [ ] Write failing tests `web/src/pages/UploadPage.test.tsx`. The test mocks `../api/client`, `../lib/deviceId`, and `../lib/downscaleImage`, and stubs `URL.createObjectURL`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { PublicEvent, Photo } from '../api/types';

vi.mock('../api/client');
vi.mock('../lib/deviceId', () => ({ getDeviceId: () => 'dev-test', DEVICE_ID_KEY: 'rtpa_device_id' }));
vi.mock('../lib/downscaleImage', () => ({ downscaleImage: vi.fn(async (f: File) => f) }));

import { getPublicEvent, uploadFiles } from '../api/client';
import UploadPage from './UploadPage';

const baseEvent: PublicEvent = {
  code: 'PARTY1',
  name: 'Sam & Lee',
  status: 'active',
  uploadEnabled: true,
  theme: {
    id: 'preset-midnight-gala',
    name: 'Midnight Gala',
    isPreset: true,
    tokens: {
      background: { type: 'solid', value: '#10131c' },
      ambient: 'none',
      frame: { style: 'thin', borderColor: '#fff', borderWidth: 2, radius: 8, shadow: true },
      caption: { enabled: true, bg: '#000', color: '#fff' },
      font: 'Inter, sans-serif',
      accent: '#c9a227',
    },
  },
  motionConfig: {
    motionWeights: { drift: 5, current: 2, orbit: 1, mosaic: 2 },
    speed: 1,
    maxOnCanvas: 24,
    dwell: { enabled: true, durationMs: 45000, varianceMs: 15000 },
    enterWeights: { flyInEdge: 3, scalePop: 2, fadeGrow: 2, spinIn: 1, dropBounce: 2 },
    leaveWeights: { driftOffEdge: 3, shrinkFade: 3, spinOut: 1, slideAway: 2 },
    baseSize: 220,
    sizeVariance: 0.4,
  },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/e/PARTY1']}>
        <Routes>
          <Route path="/e/:code" element={<UploadPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('UploadPage', () => {
  it('renders the event name and the be-responsible note', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    renderPage();
    expect(await screen.findByText('Sam & Lee')).toBeInTheDocument();
    expect(screen.getByText(/be responsible/i)).toBeInTheDocument();
  });

  it('shows the closed state when uploadEnabled is false', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue({ ...baseEvent, uploadEnabled: false });
    renderPage();
    expect(await screen.findByText(/uploads are closed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/add photos/i)).not.toBeInTheDocument();
  });

  it('shows the closed state when status is ended', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue({ ...baseEvent, status: 'ended' });
    renderPage();
    expect(await screen.findByText(/uploads are closed/i)).toBeInTheDocument();
  });

  it('shows a not-found state on 404', async () => {
    vi.mocked(getPublicEvent).mockRejectedValue(Object.assign(new Error('x'), { status: 404 }));
    renderPage();
    expect(await screen.findByText(/can.?t find that party/i)).toBeInTheDocument();
  });

  it('persists the typed name to localStorage', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    renderPage();
    const input = await screen.findByLabelText(/your name/i);
    await userEvent.type(input, 'Robin');
    expect(localStorage.getItem('rtpa_uploader_name')).toBe('Robin');
  });

  it('uploads selected files with deviceId + name and renders progress then success', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    const photo: Photo = {
      id: 'p1',
      eventId: 'e1',
      uploaderName: 'Robin',
      mediaType: 'image',
      width: 1600,
      height: 1200,
      durationMs: null,
      createdAt: new Date().toISOString(),
      isHidden: false,
      displayUrl: '/media/display/p1.jpg',
      thumbUrl: '/media/thumb/p1.jpg',
    };
    vi.mocked(uploadFiles).mockImplementation(async (_code, args) => {
      args.onProgress?.(0.5);
      args.onProgress?.(1);
      return [photo];
    });

    renderPage();
    const input = await screen.findByLabelText(/your name/i);
    await userEvent.type(input, 'Robin');

    const file = new File(['x'], 'pic.jpg', { type: 'image/jpeg' });
    const picker = screen.getByLabelText(/add photos/i) as HTMLInputElement;
    await userEvent.upload(picker, file);

    await waitFor(() => expect(uploadFiles).toHaveBeenCalledTimes(1));
    const callArgs = vi.mocked(uploadFiles).mock.calls[0];
    expect(callArgs[0]).toBe('PARTY1');
    expect(callArgs[1].uploaderName).toBe('Robin');
    expect(callArgs[1].deviceId).toBe('dev-test');
    expect(callArgs[1].files).toHaveLength(1);

    expect(await screen.findByText(/added to the party/i)).toBeInTheDocument();
    expect(screen.getByTestId('contribution-strip').querySelectorAll('img')).toHaveLength(1);
  });

  it('shows a rejection toast for unsupported files and does not upload them', async () => {
    vi.mocked(getPublicEvent).mockResolvedValue(baseEvent);
    renderPage();
    await screen.findByLabelText(/your name/i);

    const bad = new File(['x'], 'note.txt', { type: 'text/plain' });
    const picker = screen.getByLabelText(/add photos/i) as HTMLInputElement;
    await userEvent.upload(picker, bad);

    expect(await screen.findByRole('alert')).toHaveTextContent(/note\.txt/i);
    expect(uploadFiles).not.toHaveBeenCalled();
  });
});
```

- [ ] Run `npm test -w @rtpa/web -- UploadPage.test.tsx` → expect **FAIL**.
- [ ] Replace `web/src/pages/UploadPage.tsx` with the full implementation:

```tsx
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Photo } from '../api/types';
import { getPublicEvent, uploadFiles, ApiError } from '../api/client';
import { getDeviceId } from '../lib/deviceId';
import { themeToCssVars, backgroundStyle } from '../lib/themeCss';
import { useUploaderName } from '../lib/useUploaderName';
import { downscaleImage } from '../lib/downscaleImage';
import { validateFiles } from '../lib/validateUpload';
import { DEFAULT_MEDIA_LIMITS } from '@rtpa/shared';
import './UploadPage.css';

interface Contribution {
  id: string;
  thumbUrl: string;
}

export default function UploadPage() {
  const { code = '' } = useParams<{ code: string }>();
  const { name, setName } = useUploaderName();
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [rejections, setRejections] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const eventQuery = useQuery({
    queryKey: ['public-event', code],
    queryFn: () => getPublicEvent(code),
  });

  const event = eventQuery.data;

  const pageStyle = useMemo(() => {
    if (!event) return {};
    return {
      ...themeToCssVars(event.theme.tokens),
      ...backgroundStyle(event.theme.tokens),
      fontFamily: 'var(--rtpa-font)',
    };
  }, [event]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !event) return;
    setUploadError(null);

    const picked = Array.from(fileList);
    const { accepted, rejected } = validateFiles(picked, DEFAULT_MEDIA_LIMITS);

    if (rejected.length > 0) {
      setRejections((prev) => [
        ...prev,
        ...rejected.map((r) =>
          r.reason === 'too-large'
            ? `${r.file.name} is too large`
            : `${r.file.name} isn't a supported photo or video`,
        ),
      ]);
    }

    if (accepted.length === 0) return;

    const prepared = await Promise.all(accepted.map((f) => downscaleImage(f)));

    setUploading(true);
    setProgress(0);
    try {
      const photos = await uploadFiles(code, {
        uploaderName: name.trim() || 'Guest',
        deviceId: getDeviceId(),
        files: prepared,
        onProgress: (fraction) => setProgress(fraction),
      });
      const next: Contribution[] = photos.map((p: Photo) => ({
        id: p.id,
        thumbUrl: p.thumbUrl,
      }));
      setContributions((prev) => [...next, ...prev]);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 403
          ? 'Uploads just closed — sorry!'
          : 'Upload failed. Please try again.';
      setUploadError(message);
    } finally {
      setUploading(false);
    }
  }

  if (eventQuery.isLoading) {
    return (
      <div className="rtpa-upload rtpa-upload--state" data-testid="upload-loading">
        <p>Loading the party…</p>
      </div>
    );
  }

  if (eventQuery.isError || !event) {
    const notFound = eventQuery.error instanceof ApiError && eventQuery.error.status === 404;
    return (
      <div className="rtpa-upload rtpa-upload--state" data-testid="upload-error">
        <p>{notFound ? "We can't find that party." : 'Something went wrong loading the party.'}</p>
      </div>
    );
  }

  const closed = !event.uploadEnabled || event.status === 'ended';

  return (
    <div className="rtpa-upload" style={pageStyle}>
      <header className="rtpa-upload__header">
        <h1 className="rtpa-upload__title">{event.name}</h1>
        <p className="rtpa-upload__note">
          📸 Please be responsible — your name shows with what you add, and the host can
          remove anything.
        </p>
      </header>

      {closed ? (
        <section className="rtpa-upload__closed" data-testid="upload-closed">
          <p>Uploads are closed for this party. Thanks for celebrating! 🎉</p>
        </section>
      ) : (
        <section className="rtpa-upload__body">
          <label className="rtpa-upload__field">
            <span>Your name</span>
            <input
              type="text"
              value={name}
              placeholder="e.g. Robin"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="rtpa-upload__add" aria-label="Add photos / videos">
            <span className="rtpa-upload__add-label">＋ Add photos / videos</span>
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              capture="environment"
              className="rtpa-upload__file-input"
              disabled={uploading}
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>

          {uploading && (
            <div className="rtpa-upload__progress" data-testid="upload-progress">
              <div
                className="rtpa-upload__progress-bar"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}

          {uploadError && (
            <p className="rtpa-upload__toast" role="alert">
              {uploadError}
            </p>
          )}

          {rejections.map((message, i) => (
            <p className="rtpa-upload__toast" role="alert" key={`${message}-${i}`}>
              {message}
            </p>
          ))}

          {contributions.length > 0 && (
            <div className="rtpa-upload__success" data-testid="upload-success">
              <p>✅ Added to the party!</p>
              <div className="rtpa-upload__strip" data-testid="contribution-strip">
                {contributions.map((c) => (
                  <img key={c.id} src={c.thumbUrl} alt="Your contribution" />
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] Run `npm test -w @rtpa/web -- UploadPage.test.tsx` → expect **PASS** (CSS import resolves because Task 9 creates the file; if doing Task 9 after, create an empty `UploadPage.css` first so the import resolves, then fill it in Task 9).
- [ ] `git commit -m "feat(web): guest UploadPage with validate/downscale/upload pipeline and states"`

---

### Task 9 — Mobile-first Upload page CSS (`src/pages/UploadPage.css`)

**Files:**
- `web/src/pages/UploadPage.css`

This is visual-only and already exercised by the Task 8 render tests (which import the file and rely on `data-testid`/labels, not specific styles). Provide real, complete CSS driven by the theme CSS variables.

Steps:

- [ ] Create `web/src/pages/UploadPage.css`:

```css
:root {
  --rtpa-accent: #c9a227;
  --rtpa-font: system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

.rtpa-upload {
  min-height: 100vh;
  min-height: 100dvh;
  margin: 0;
  padding: clamp(16px, 5vw, 32px);
  display: flex;
  flex-direction: column;
  gap: 20px;
  color: #fff;
  font-family: var(--rtpa-font);
  background: #10131c;
}

.rtpa-upload--state {
  align-items: center;
  justify-content: center;
  text-align: center;
}

.rtpa-upload__header {
  text-align: center;
}

.rtpa-upload__title {
  margin: 0 0 8px;
  font-size: clamp(1.6rem, 6vw, 2.4rem);
  line-height: 1.1;
}

.rtpa-upload__note {
  margin: 0 auto;
  max-width: 28rem;
  font-size: 0.9rem;
  opacity: 0.85;
}

.rtpa-upload__body,
.rtpa-upload__closed {
  width: 100%;
  max-width: 32rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.rtpa-upload__closed {
  text-align: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 16px;
}

.rtpa-upload__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.95rem;
}

.rtpa-upload__field input {
  padding: 14px 16px;
  font-size: 1rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
}

.rtpa-upload__field input:focus {
  outline: 2px solid var(--rtpa-accent);
  outline-offset: 1px;
}

.rtpa-upload__add {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 88px;
  padding: 20px;
  border-radius: 18px;
  border: 2px dashed var(--rtpa-accent);
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
  text-align: center;
}

.rtpa-upload__add-label {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--rtpa-accent);
}

.rtpa-upload__file-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.rtpa-upload__progress {
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
}

.rtpa-upload__progress-bar {
  height: 100%;
  background: var(--rtpa-accent);
  transition: width 0.2s ease;
}

.rtpa-upload__toast {
  margin: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(180, 30, 30, 0.85);
  color: #fff;
  font-size: 0.9rem;
}

.rtpa-upload__success {
  text-align: center;
  font-size: 1.2rem;
  font-weight: 600;
}

.rtpa-upload__strip {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.rtpa-upload__strip img {
  flex: 0 0 auto;
  width: 84px;
  height: 84px;
  object-fit: cover;
  border-radius: 12px;
  border: var(--rtpa-frame-border-width, 2px) solid var(--rtpa-frame-border-color, #fff);
  box-shadow: var(--rtpa-frame-shadow, none);
}

@media (prefers-reduced-motion: reduce) {
  .rtpa-upload__progress-bar {
    transition: none;
  }
}
```

- [ ] Re-run `npm test -w @rtpa/web -- UploadPage.test.tsx` → expect **PASS** (still green; CSS is parsed via `css: true` in vitest config).
- [ ] Run the full suite `npm test -w @rtpa/web` → expect **all PASS**.
- [ ] `git commit -m "style(web): mobile-first UploadPage CSS driven by theme vars"`

---

## Plan 4 self-check

Maps spec **§7 Guest upload experience** to the tasks that deliver each item:

- [ ] **Mobile-first, themed to the event** → Task 8 (`themeToCssVars`/`backgroundStyle` applied to page root) + Task 4 + Task 9 (responsive CSS).
- [ ] **Header: event name + "please be responsible" note** → Task 8 (`rtpa-upload__header` title + note; tested by "renders event name and the be-responsible note").
- [ ] **Name field remembered in `localStorage`** → Task 5 (`useUploaderName`, key `rtpa_uploader_name`) + Task 8 (bound input; tested by "persists the typed name").
- [ ] **Large "Add photos / videos" action → native camera/gallery; multi-select** → Task 8 (`<input type="file" accept="image/*,video/*" multiple capture="environment">`).
- [ ] **Client-side validation: type must be image/\* or video/\*** → Task 7 (`validateFiles` `bad-type`).
- [ ] **Default caps (photo ≤ 25 MB; video ≤ 60 MB)** → Task 7 (size caps from `DEFAULT_MEDIA_LIMITS`); video ≤ 30 s enforced server-side per §12 (noted in Task 7).
- [ ] **Images downscaled in-browser before upload** → Task 6 (`downscaleImage`, longest edge ≤ 1600, JPEG q0.85) + Task 8 (applied before upload).
- [ ] **Per-file upload progress** → Task 2 (`uploadFiles` XHR `onProgress`) + Task 8 (progress bar).
- [ ] **Success state "✅ added to the party!" with a thumbnail strip of the guest's own contributions** → Task 8 (`upload-success` + `contribution-strip`; tested).
- [ ] **Silently captures `device_id` (UUID in localStorage), user_agent, server-side IP** → Task 3 (`getDeviceId`, key `rtpa_device_id`) + Task 8 (sent in `uploadFiles`); `user_agent`/`ip_address` captured server-side (Plan 3).
- [ ] **If `upload_enabled` is off → polite "uploads are closed"** → Task 8 (closed state for `!uploadEnabled` or `status==='ended'`; two tests).
- [ ] **Loading + 404 states** → Task 8 (`upload-loading`, not-found copy; tested).
- [ ] **Shared `web` skeleton for Plans 5 & 6** → Task 1 (router with `/e/:code`, `/e/:code/display`, `/admin/*`; QueryClient + RouterProvider; smoke test).
