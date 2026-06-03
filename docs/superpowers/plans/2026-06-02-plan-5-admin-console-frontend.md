# RTPartyAlbum — Plan 5: Admin Console Front-end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the password-gated admin Single-Page Application under `web/src/admin/`. It lets an operator log in, manage events, moderate the live album in real time, tune the gliding-canvas motion/animation/size behavior, build and select themes, and manage global settings. This plan **extends** the web app skeleton produced by Plan 4 (it only *modifies* `web/src/router.tsx`; everything else under `web/src/admin/` is new).

**Architecture:** A typed admin API client (`src/admin/api.ts`) wraps every `/api/admin/*` endpoint from the shared contracts. A React Context (`AuthContext`) checks `/api/admin/me` on mount and exposes `login`/`logout`/`status`. A `RequireAdmin` guard wraps the admin route subtree. `AdminLayout` renders the nav shell; `AdminRoutes` declares the nested routes and is mounted into the existing app router. Feature pages (`EventsPage`, `EventDetailPage` with `AlbumTab`/`DisplayTab`/`ShareTab`, `ThemesPage`/`ThemeEditor`, `SettingsPage`) use `@tanstack/react-query` for server state and the existing `socket.io-client` socket (`src/lib/socket.ts`) for live album updates in the `event:<code>` room. All server state types come **verbatim** from `@rtpa/shared` (`EventSummary`, `EventDetail`, `PhotoAdmin`, `MotionConfig`, `Theme`, `ThemeTokens`, `MediaLimits`). Live preview reuses `src/lib/themeCss.ts`.

**Tech Stack:** React ^18.3, react-router-dom ^6.26, @tanstack/react-query ^5, socket.io-client ^4.7, TypeScript ^5.4 (ESM). Tests: Vitest ^2 (jsdom), @testing-library/react ^16, @testing-library/jest-dom, `vi.fn()`/`vi.mock` for the API client, `fetch`, and a reusable fake-socket helper. Test command: `npm test -w @rtpa/web -- <file>`.

**Assumptions (from caller):** Plans 1–4 are implemented. The full server admin API exists per contracts. The Plan 4 web skeleton exists: `src/main.tsx`, `src/router.tsx` (a `createBrowserRouter` whose route table contains a placeholder route for `/admin/*`), `src/api/client.ts`, `src/api/types.ts` (re-exports `@rtpa/shared`), `src/lib/themeCss.ts` (exports `themeVars(tokens: ThemeTokens): React.CSSProperties` and `frameStyle(tokens: ThemeTokens): React.CSSProperties`), `src/lib/socket.ts` (exports `getSocket(): Socket<ServerToClientEvents, ClientToServerEvents>`), react-query, socket.io-client, and vitest + testing-library configured with jsdom + `@testing-library/jest-dom` auto-imported in a setup file.

**Shared symbols used verbatim (`@rtpa/shared`):** `EventSummary`, `EventDetail`, `PublicEvent`, `Photo`, `PhotoAdmin`, `MotionConfig`, `MotionStyle`, `EnterAnimation`, `LeaveAnimation`, `Theme`, `ThemeTokens`, `MediaLimits`, `EventStatus`, `ServerToClientEvents`, `ClientToServerEvents`, and the constants `DEFAULT_MOTION_CONFIG`, `DEFAULT_MEDIA_LIMITS`.

---

## Task 0 — Shared admin test helpers (fake socket + query wrapper)

These helpers are imported by Tasks 3–10. They are not feature code; they live under `web/src/admin/__tests__/helpers/`.

**Files:**
- `web/src/admin/__tests__/helpers/fakeSocket.ts` (new)
- `web/src/admin/__tests__/helpers/renderWithProviders.tsx` (new)
- `web/src/admin/__tests__/helpers/fakeSocket.test.ts` (new)

- [ ] Write a FAILING test `web/src/admin/__tests__/helpers/fakeSocket.test.ts` that imports `createFakeSocket` and asserts: `on('photo:added', cb)` then `emitServer('photo:added', photo)` calls `cb(photo)`; `emit('join', 'ABCD')` records `['join','ABCD']` in `socket.emitted`; `off('photo:added', cb)` stops further delivery:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { createFakeSocket } from './fakeSocket';
  import type { Photo } from '@rtpa/shared';

  const photo: Photo = {
    id: 'p1', eventId: 'e1', uploaderName: 'Sam', mediaType: 'image',
    width: 800, height: 600, durationMs: null, createdAt: '2026-06-02T10:00:00.000Z',
    isHidden: false, displayUrl: '/media/display/p1.jpg', thumbUrl: '/media/thumb/p1.jpg',
  };

  describe('createFakeSocket', () => {
    it('delivers server-emitted events to handlers', () => {
      const s = createFakeSocket();
      const cb = vi.fn();
      s.on('photo:added', cb);
      s.emitServer('photo:added', photo);
      expect(cb).toHaveBeenCalledWith(photo);
    });
    it('records client emits', () => {
      const s = createFakeSocket();
      s.emit('join', 'ABCD');
      expect(s.emitted).toEqual([['join', 'ABCD']]);
    });
    it('stops delivering after off', () => {
      const s = createFakeSocket();
      const cb = vi.fn();
      s.on('photo:added', cb);
      s.off('photo:added', cb);
      s.emitServer('photo:added', photo);
      expect(cb).not.toHaveBeenCalled();
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/helpers/fakeSocket.test.ts` and expect **FAIL** (module not found).
- [ ] COMPLETE `web/src/admin/__tests__/helpers/fakeSocket.ts`:
  ```ts
  import type { ServerToClientEvents, ClientToServerEvents } from '@rtpa/shared';

  type ServerEvent = keyof ServerToClientEvents;
  type ClientEvent = keyof ClientToServerEvents;

  export interface FakeSocket {
    on<E extends ServerEvent>(event: E, cb: ServerToClientEvents[E]): FakeSocket;
    off<E extends ServerEvent>(event: E, cb: ServerToClientEvents[E]): FakeSocket;
    emit<E extends ClientEvent>(event: E, ...args: Parameters<ClientToServerEvents[E]>): FakeSocket;
    emitServer<E extends ServerEvent>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
    connected: boolean;
    emitted: Array<[string, ...unknown[]]>;
    handlers: Map<string, Set<(...a: unknown[]) => void>>;
  }

  export function createFakeSocket(): FakeSocket {
    const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
    const emitted: Array<[string, ...unknown[]]> = [];
    const socket: FakeSocket = {
      connected: true,
      emitted,
      handlers,
      on(event, cb) {
        const set = handlers.get(event as string) ?? new Set();
        set.add(cb as (...a: unknown[]) => void);
        handlers.set(event as string, set);
        return socket;
      },
      off(event, cb) {
        handlers.get(event as string)?.delete(cb as (...a: unknown[]) => void);
        return socket;
      },
      emit(event, ...args) {
        emitted.push([event as string, ...(args as unknown[])]);
        return socket;
      },
      emitServer(event, ...args) {
        handlers.get(event as string)?.forEach((h) => h(...(args as unknown[])));
      },
    };
    return socket;
  }
  ```
- [ ] COMPLETE `web/src/admin/__tests__/helpers/renderWithProviders.tsx` (used by later tasks; a React-Query + MemoryRouter wrapper):
  ```tsx
  import { ReactElement, ReactNode } from 'react';
  import { render, RenderOptions } from '@testing-library/react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter } from 'react-router-dom';

  export function makeQueryClient(): QueryClient {
    return new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  }

  interface Opts extends Omit<RenderOptions, 'wrapper'> {
    route?: string;
    client?: QueryClient;
  }

  export function renderWithProviders(ui: ReactElement, opts: Opts = {}) {
    const client = opts.client ?? makeQueryClient();
    const route = opts.route ?? '/';
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </QueryClientProvider>
      );
    }
    return { client, ...render(ui, { wrapper: Wrapper, ...opts }) };
  }
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/helpers/fakeSocket.test.ts` and expect **PASS**.
- [ ] Commit: `test(web): add admin fake-socket and provider test helpers`.

---

## Task 1 — Admin API client (`src/admin/api.ts`)

Typed wrappers for every admin endpoint in the contracts.

**Files:**
- `web/src/admin/api.ts` (new)
- `web/src/admin/__tests__/api.test.ts` (new)

- [ ] Write FAILING test `web/src/admin/__tests__/api.test.ts` covering a representative subset (URL, method, body, credentials, and url-builders). Mock global `fetch`:
  ```ts
  import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
  import { adminApi } from '../api';
  import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  describe('adminApi', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('login POSTs password with credentials', async () => {
      await adminApi.login('hunter2');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/admin/login');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(JSON.parse(init.body)).toEqual({ password: 'hunter2' });
    });

    it('me GETs /api/admin/me', async () => {
      await adminApi.me();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/me');
      expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    });

    it('logout POSTs /api/admin/logout (204, no json parse)', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await adminApi.logout();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/logout');
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    });

    it('listEvents GETs /api/admin/events', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]));
      await adminApi.listEvents();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/events');
    });

    it('createEvent POSTs name', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await adminApi.createEvent('My Party');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/admin/events');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ name: 'My Party' });
    });

    it('setUploadState POSTs upload-state with enabled', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await adminApi.setUploadState('e1', false);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/admin/events/e1/upload-state');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ enabled: false });
    });

    it('setMotion PUTs motionConfig', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await adminApi.setMotion('e1', DEFAULT_MOTION_CONFIG);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/admin/events/e1/motion');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ motionConfig: DEFAULT_MOTION_CONFIG });
    });

    it('setEventTheme PUTs themeId', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await adminApi.setEventTheme('e1', 'preset-neon-night');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/admin/events/e1/theme');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ themeId: 'preset-neon-night' });
    });

    it('hidePhoto POSTs hidden flag', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await adminApi.hidePhoto('p1', true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/admin/photos/p1/hide');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ hidden: true });
    });

    it('deletePhoto DELETEs', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await adminApi.deletePhoto('p1');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/admin/photos/p1');
      expect(init.method).toBe('DELETE');
    });

    it('createTheme POSTs name+tokens', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      const tokens = { background: { type: 'solid', value: '#000' } } as never;
      await adminApi.createTheme('Mine', tokens);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/admin/themes');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ name: 'Mine', tokens });
    });

    it('saveSettings PUTs partial', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      await adminApi.saveSettings({ publicBaseUrl: 'https://x.test' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/admin/settings');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ publicBaseUrl: 'https://x.test' });
    });

    it('changePassword POSTs current+next', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await adminApi.changePassword('old', 'new');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/admin/password');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ current: 'old', next: 'new' });
    });

    it('qrUrl and exportUrl build event urls', () => {
      expect(adminApi.qrUrl('e1')).toBe('/api/admin/events/e1/qr');
      expect(adminApi.exportUrl('e1')).toBe('/api/admin/events/e1/export');
    });

    it('throws ApiError on non-ok', async () => {
      fetchMock.mockResolvedValueOnce(new Response('nope', { status: 401 }));
      await expect(adminApi.me()).rejects.toMatchObject({ status: 401 });
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/api.test.ts` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/api.ts`:
  ```ts
  import type {
    EventSummary, EventDetail, PhotoAdmin, MotionConfig, Theme, ThemeTokens, MediaLimits,
  } from '@rtpa/shared';

  export class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  async function request<T>(url: string, init: RequestInit, parse: boolean): Promise<T> {
    const res = await fetch(url, { credentials: 'include', ...init });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.text()) || msg; } catch { /* ignore */ }
      throw new ApiError(res.status, msg);
    }
    if (!parse) return undefined as T;
    return (await res.json()) as T;
  }

  function getJson<T>(url: string): Promise<T> {
    return request<T>(url, { method: 'GET' }, true);
  }
  function postJson<T>(url: string, body?: unknown): Promise<T> {
    return request<T>(url, { method: 'POST', headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) }, true);
  }
  function postNoBody(url: string, body?: unknown): Promise<void> {
    return request<void>(url, { method: 'POST', headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) }, false);
  }
  function putJson<T>(url: string, body: unknown): Promise<T> {
    return request<T>(url, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) }, true);
  }
  function del(url: string): Promise<void> {
    return request<void>(url, { method: 'DELETE' }, false);
  }

  export interface SettingsDto {
    publicBaseUrl: string;
    mediaLimits: MediaLimits;
  }

  export const adminApi = {
    // Auth
    login: (password: string) => postNoBody('/api/admin/login', { password }),
    logout: () => postNoBody('/api/admin/logout'),
    me: () => getJson<{ ok: true }>('/api/admin/me'),

    // Events
    listEvents: () => getJson<EventSummary[]>('/api/admin/events'),
    createEvent: (name: string) => postJson<EventDetail>('/api/admin/events', { name }),
    getEvent: (id: string) => getJson<EventDetail>(`/api/admin/events/${id}`),
    activateEvent: (id: string) => postJson<EventDetail>(`/api/admin/events/${id}/activate`),
    setUploadState: (id: string, enabled: boolean) =>
      postJson<EventDetail>(`/api/admin/events/${id}/upload-state`, { enabled }),
    endEvent: (id: string) => postJson<EventDetail>(`/api/admin/events/${id}/end`),
    setMotion: (id: string, motionConfig: MotionConfig) =>
      putJson<EventDetail>(`/api/admin/events/${id}/motion`, { motionConfig }),
    setEventTheme: (id: string, themeId: string) =>
      putJson<EventDetail>(`/api/admin/events/${id}/theme`, { themeId }),
    qrUrl: (id: string) => `/api/admin/events/${id}/qr`,
    exportUrl: (id: string) => `/api/admin/events/${id}/export`,

    // Photos
    listPhotos: (eventId: string) => getJson<PhotoAdmin[]>(`/api/admin/events/${eventId}/photos`),
    hidePhoto: (id: string, hidden: boolean) => postNoBody(`/api/admin/photos/${id}/hide`, { hidden }),
    deletePhoto: (id: string) => del(`/api/admin/photos/${id}`),

    // Themes
    listThemes: () => getJson<Theme[]>('/api/admin/themes'),
    createTheme: (name: string, tokens: ThemeTokens) =>
      postJson<Theme>('/api/admin/themes', { name, tokens }),
    updateTheme: (id: string, input: { name?: string; tokens?: ThemeTokens }) =>
      putJson<Theme>(`/api/admin/themes/${id}`, input),
    deleteTheme: (id: string) => del(`/api/admin/themes/${id}`),

    // Settings
    getSettings: () => getJson<SettingsDto>('/api/admin/settings'),
    saveSettings: (input: Partial<SettingsDto>) => putJson<SettingsDto>('/api/admin/settings', input),
    changePassword: (current: string, next: string) =>
      postNoBody('/api/admin/password', { current, next }),
  };

  export type AdminApi = typeof adminApi;
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/api.test.ts` and expect **PASS**.
- [ ] Commit: `feat(web): typed admin API client`.

---

## Task 2 — Auth context, LoginPage, RequireAdmin guard

**Files:**
- `web/src/admin/AuthContext.tsx` (new)
- `web/src/admin/LoginPage.tsx` (new)
- `web/src/admin/RequireAdmin.tsx` (new)
- `web/src/admin/__tests__/auth.test.tsx` (new)

- [ ] Write FAILING test `web/src/admin/__tests__/auth.test.tsx`:
  ```tsx
  import { describe, it, expect, beforeEach, vi } from 'vitest';
  import { render, screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import { AuthProvider } from '../AuthContext';
  import { LoginPage } from '../LoginPage';
  import { RequireAdmin } from '../RequireAdmin';

  vi.mock('../api', () => {
    const ApiError = class extends Error { status: number; constructor(s: number, m: string){ super(m); this.status = s; } };
    return {
      ApiError,
      adminApi: {
        me: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
      },
    };
  });
  import { adminApi, ApiError } from '../api';

  function Protected() {
    return (
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin/login" element={<LoginPage />} />
            <Route path="/admin" element={<RequireAdmin><div>SECRET</div></RequireAdmin>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
  }

  describe('admin auth', () => {
    beforeEach(() => vi.clearAllMocks());

    it('redirects to login when /me rejects 401', async () => {
      (adminApi.me as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'no'));
      render(<Protected />);
      expect(await screen.findByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
    });

    it('shows secret when /me resolves', async () => {
      (adminApi.me as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
      render(<Protected />);
      expect(await screen.findByText('SECRET')).toBeInTheDocument();
    });

    it('login success transitions to authenticated', async () => {
      (adminApi.me as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ApiError(401, 'no'));
      (adminApi.login as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      render(<Protected />);
      const input = await screen.findByLabelText(/password/i);
      await userEvent.type(input, 'hunter2');
      await userEvent.click(screen.getByRole('button', { name: /log in/i }));
      await waitFor(() => expect(screen.getByText('SECRET')).toBeInTheDocument());
    });

    it('wrong password shows error on 401', async () => {
      (adminApi.me as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'no'));
      (adminApi.login as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'bad'));
      render(<Protected />);
      const input = await screen.findByLabelText(/password/i);
      await userEvent.type(input, 'wrong');
      await userEvent.click(screen.getByRole('button', { name: /log in/i }));
      expect(await screen.findByText(/incorrect password/i)).toBeInTheDocument();
    });

    it('rate-limit shows message on 429', async () => {
      (adminApi.me as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'no'));
      (adminApi.login as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(429, 'slow'));
      render(<Protected />);
      const input = await screen.findByLabelText(/password/i);
      await userEvent.type(input, 'x');
      await userEvent.click(screen.getByRole('button', { name: /log in/i }));
      expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/auth.test.tsx` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/AuthContext.tsx`:
  ```tsx
  import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
  import { adminApi, ApiError } from './api';

  export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

  export interface AuthContextValue {
    status: AuthStatus;
    login: (password: string) => Promise<void>;
    logout: () => Promise<void>;
  }

  const AuthContext = createContext<AuthContextValue | null>(null);

  export function AuthProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AuthStatus>('loading');

    useEffect(() => {
      let alive = true;
      adminApi
        .me()
        .then(() => { if (alive) setStatus('authenticated'); })
        .catch(() => { if (alive) setStatus('unauthenticated'); });
      return () => { alive = false; };
    }, []);

    const login = useCallback(async (password: string) => {
      await adminApi.login(password); // throws ApiError on 401/429
      setStatus('authenticated');
    }, []);

    const logout = useCallback(async () => {
      try { await adminApi.logout(); } catch { /* ignore */ }
      setStatus('unauthenticated');
    }, []);

    return (
      <AuthContext.Provider value={{ status, login, logout }}>{children}</AuthContext.Provider>
    );
  }

  export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
  }

  export { ApiError };
  ```
- [ ] COMPLETE `web/src/admin/LoginPage.tsx`:
  ```tsx
  import { FormEvent, useState } from 'react';
  import { useAuth } from './AuthContext';
  import { ApiError } from './api';

  export function LoginPage() {
    const { login } = useAuth();
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function onSubmit(e: FormEvent) {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        await login(password);
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          setError('Too many attempts. Please wait and try again.');
        } else if (err instanceof ApiError && err.status === 401) {
          setError('Incorrect password.');
        } else {
          setError('Something went wrong. Please try again.');
        }
      } finally {
        setBusy(false);
      }
    }

    return (
      <form onSubmit={onSubmit} aria-label="Admin login">
        <h1>Admin Login</h1>
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>Log in</button>
      </form>
    );
  }
  ```
- [ ] COMPLETE `web/src/admin/RequireAdmin.tsx`:
  ```tsx
  import { ReactNode } from 'react';
  import { Navigate } from 'react-router-dom';
  import { useAuth } from './AuthContext';

  export function RequireAdmin({ children }: { children: ReactNode }) {
    const { status } = useAuth();
    if (status === 'loading') return <p>Loading…</p>;
    if (status === 'unauthenticated') return <Navigate to="/admin/login" replace />;
    return <>{children}</>;
  }
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/auth.test.tsx` and expect **PASS**.
- [ ] Commit: `feat(web): admin auth context, login page, route guard`.

---

## Task 3 — Admin shell + route wiring

**Files:**
- `web/src/admin/AdminLayout.tsx` (new)
- `web/src/admin/AdminRoutes.tsx` (new)
- `web/src/router.tsx` (MODIFY — replace the `/admin/*` placeholder)
- `web/src/admin/__tests__/AdminLayout.test.tsx` (new)

- [ ] Write FAILING test `web/src/admin/__tests__/AdminLayout.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { MemoryRouter, Routes, Route } from 'react-router-dom';
  import { AdminLayout } from '../AdminLayout';

  const logout = vi.fn();
  vi.mock('../AuthContext', () => ({
    useAuth: () => ({ status: 'authenticated', login: vi.fn(), logout }),
  }));

  function renderShell() {
    return render(
      <MemoryRouter initialEntries={['/admin/events']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="events" element={<div>EVENTS PANE</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  describe('AdminLayout', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders nav links and child outlet', () => {
      renderShell();
      expect(screen.getByRole('link', { name: /events/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /themes/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
      expect(screen.getByText('EVENTS PANE')).toBeInTheDocument();
    });

    it('logout button calls logout', async () => {
      renderShell();
      await userEvent.click(screen.getByRole('button', { name: /log out/i }));
      expect(logout).toHaveBeenCalled();
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/AdminLayout.test.tsx` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/AdminLayout.tsx`:
  ```tsx
  import { NavLink, Outlet } from 'react-router-dom';
  import { useAuth } from './AuthContext';

  export function AdminLayout() {
    const { logout } = useAuth();
    return (
      <div className="admin-shell">
        <header className="admin-topbar">
          <strong>RTPartyAlbum Admin</strong>
          <button type="button" onClick={() => { void logout(); }}>Log out</button>
        </header>
        <nav className="admin-nav">
          <NavLink to="/admin/events">Events</NavLink>
          <NavLink to="/admin/themes">Themes</NavLink>
          <NavLink to="/admin/settings">Settings</NavLink>
        </nav>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    );
  }
  ```
- [ ] COMPLETE `web/src/admin/AdminRoutes.tsx` (declares the nested admin subtree; imports of EventsPage/EventDetailPage/ThemesPage/SettingsPage are added as those tasks land — define the file now with the routes that exist after each task; final form below is the target):
  ```tsx
  import { Routes, Route, Navigate } from 'react-router-dom';
  import { AuthProvider } from './AuthContext';
  import { RequireAdmin } from './RequireAdmin';
  import { LoginPage } from './LoginPage';
  import { AdminLayout } from './AdminLayout';
  import { EventsPage } from './EventsPage';
  import { EventDetailPage } from './event/EventDetailPage';
  import { ThemesPage } from './ThemesPage';
  import { SettingsPage } from './SettingsPage';

  export function AdminRoutes() {
    return (
      <AuthProvider>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<Navigate to="events" replace />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="events/:eventId" element={<EventDetailPage />} />
            <Route path="themes" element={<ThemesPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="events" replace />} />
        </Routes>
      </AuthProvider>
    );
  }
  ```
  Note: The imports for `EventsPage`, `EventDetailPage`, `ThemesPage`, and `SettingsPage` reference files created in Tasks 4, 5, 9, and 10. To keep the build green between tasks, create each page as a minimal `export function X() { return null; }` stub when first imported, then flesh it out in its own task. (`AdminLayout`/`AuthProvider`/`RequireAdmin`/`LoginPage` already exist.)
- [ ] MODIFY `web/src/router.tsx`: replace the Plan-4 `/admin/*` placeholder route element with `<AdminRoutes />`. The router uses `createBrowserRouter`; mount the admin subtree as a wildcard so the inner `<Routes>` handles nested paths:
  ```tsx
  // add import near other route imports:
  import { AdminRoutes } from './admin/AdminRoutes';

  // within the route table, replace the existing placeholder:
  // { path: '/admin/*', element: <div>admin placeholder</div> }
  // with:
  { path: '/admin/*', element: <AdminRoutes /> },
  ```
  (Leave all other Plan-4 routes — `/e/:eventCode`, `/e/:eventCode/display`, etc. — untouched.)
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/AdminLayout.test.tsx` and expect **PASS**.
- [ ] Commit: `feat(web): admin shell layout and router wiring`.

---

## Task 4 — Events list page

**Files:**
- `web/src/admin/EventsPage.tsx` (new — replaces stub)
- `web/src/admin/__tests__/EventsPage.test.tsx` (new)

- [ ] Write FAILING test `web/src/admin/__tests__/EventsPage.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { EventsPage } from '../EventsPage';
  import { renderWithProviders } from './helpers/renderWithProviders';
  import type { EventSummary, EventDetail } from '@rtpa/shared';

  vi.mock('../api', () => ({
    adminApi: { listEvents: vi.fn(), createEvent: vi.fn() },
  }));
  import { adminApi } from '../api';

  const navigate = vi.fn();
  vi.mock('react-router-dom', async (orig) => {
    const actual = await orig<typeof import('react-router-dom')>();
    return { ...actual, useNavigate: () => navigate };
  });

  const summary: EventSummary = {
    id: 'e1', code: 'ABCD', name: 'Sara Birthday', createdAt: '2026-06-01T12:00:00.000Z',
    isActive: true, uploadEnabled: true, status: 'active', themeId: 'preset-midnight-gala', photoCount: 7,
  };
  const created: EventDetail = { ...summary, id: 'e2', code: 'WXYZ', name: 'New', motionConfig: {} as never };

  describe('EventsPage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (adminApi.listEvents as ReturnType<typeof vi.fn>).mockResolvedValue([summary]);
      (adminApi.createEvent as ReturnType<typeof vi.fn>).mockResolvedValue(created);
    });

    it('renders events with status badge and photo count', async () => {
      renderWithProviders(<EventsPage />);
      expect(await screen.findByText('Sara Birthday')).toBeInTheDocument();
      expect(screen.getByText(/active/i)).toBeInTheDocument();
      expect(screen.getByText(/7/)).toBeInTheDocument();
    });

    it('create flow prompts, posts, navigates to detail', async () => {
      vi.spyOn(window, 'prompt').mockReturnValue('New');
      renderWithProviders(<EventsPage />);
      await screen.findByText('Sara Birthday');
      await userEvent.click(screen.getByRole('button', { name: /create event/i }));
      await waitFor(() => expect(adminApi.createEvent).toHaveBeenCalledWith('New'));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin/events/e2'));
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/EventsPage.test.tsx` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/EventsPage.tsx`:
  ```tsx
  import { Link, useNavigate } from 'react-router-dom';
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
  import { adminApi } from './api';
  import type { EventSummary } from '@rtpa/shared';

  function StatusBadge({ status }: { status: EventSummary['status'] }) {
    return <span className={`badge badge-${status}`}>{status}</span>;
  }

  export function EventsPage() {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const { data: events, isLoading } = useQuery({
      queryKey: ['admin', 'events'],
      queryFn: () => adminApi.listEvents(),
    });

    const createMut = useMutation({
      mutationFn: (name: string) => adminApi.createEvent(name),
      onSuccess: (detail) => {
        void qc.invalidateQueries({ queryKey: ['admin', 'events'] });
        navigate(`/admin/events/${detail.id}`);
      },
    });

    function onCreate() {
      const name = window.prompt('Event name?');
      if (name && name.trim()) createMut.mutate(name.trim());
    }

    return (
      <section>
        <header className="page-head">
          <h1>Events</h1>
          <button type="button" onClick={onCreate} disabled={createMut.isPending}>Create event</button>
        </header>
        {isLoading && <p>Loading…</p>}
        <ul className="event-list">
          {(events ?? []).map((ev) => (
            <li key={ev.id}>
              <Link to={`/admin/events/${ev.id}`}>{ev.name}</Link>
              <StatusBadge status={ev.status} />
              <span className="photo-count">{ev.photoCount} photos</span>
              <span className="created-at">{new Date(ev.createdAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/EventsPage.test.tsx` and expect **PASS**.
- [ ] Commit: `feat(web): admin events list and create flow`.

---

## Task 5 — Event detail shell with tabs

**Files:**
- `web/src/admin/event/EventDetailPage.tsx` (new — replaces stub)
- `web/src/admin/__tests__/EventDetailPage.test.tsx` (new)

- [ ] Write FAILING test `web/src/admin/__tests__/EventDetailPage.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { Routes, Route } from 'react-router-dom';
  import { EventDetailPage } from '../event/EventDetailPage';
  import { renderWithProviders } from './helpers/renderWithProviders';
  import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';
  import type { EventDetail } from '@rtpa/shared';

  vi.mock('../api', () => ({ adminApi: { getEvent: vi.fn() } }));
  import { adminApi } from '../api';

  // stub heavy tab children so this test only exercises tab switching
  vi.mock('../event/AlbumTab', () => ({ AlbumTab: () => <div>ALBUM TAB</div> }));
  vi.mock('../event/DisplayTab', () => ({ DisplayTab: () => <div>DISPLAY TAB</div> }));
  vi.mock('../event/ShareTab', () => ({ ShareTab: () => <div>SHARE TAB</div> }));

  const detail: EventDetail = {
    id: 'e1', code: 'ABCD', name: 'Sara Birthday', createdAt: '2026-06-01T12:00:00.000Z',
    isActive: true, uploadEnabled: true, status: 'active', themeId: 'preset-midnight-gala',
    photoCount: 3, motionConfig: DEFAULT_MOTION_CONFIG,
  };

  describe('EventDetailPage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (adminApi.getEvent as ReturnType<typeof vi.fn>).mockResolvedValue(detail);
    });

    it('loads event and shows Album tab by default, switches tabs', async () => {
      renderWithProviders(
        <Routes><Route path="/admin/events/:eventId" element={<EventDetailPage />} /></Routes>,
        { route: '/admin/events/e1' },
      );
      expect(await screen.findByText('Sara Birthday')).toBeInTheDocument();
      expect(screen.getByText('ALBUM TAB')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: /display/i }));
      expect(screen.getByText('DISPLAY TAB')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: /qr & share/i }));
      expect(screen.getByText('SHARE TAB')).toBeInTheDocument();
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/EventDetailPage.test.tsx` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/event/EventDetailPage.tsx`:
  ```tsx
  import { useState } from 'react';
  import { useParams, Link } from 'react-router-dom';
  import { useQuery } from '@tanstack/react-query';
  import { adminApi } from '../api';
  import { AlbumTab } from './AlbumTab';
  import { DisplayTab } from './DisplayTab';
  import { ShareTab } from './ShareTab';

  type TabKey = 'album' | 'display' | 'share';
  const TABS: { key: TabKey; label: string }[] = [
    { key: 'album', label: 'Album' },
    { key: 'display', label: 'Display' },
    { key: 'share', label: 'QR & Share' },
  ];

  export function EventDetailPage() {
    const { eventId = '' } = useParams();
    const [tab, setTab] = useState<TabKey>('album');
    const { data: event, isLoading } = useQuery({
      queryKey: ['admin', 'event', eventId],
      queryFn: () => adminApi.getEvent(eventId),
      enabled: !!eventId,
    });

    if (isLoading || !event) return <p>Loading…</p>;

    return (
      <section>
        <header className="page-head">
          <Link to="/admin/events">← Events</Link>
          <h1>{event.name}</h1>
        </header>
        <div role="tablist" className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {tab === 'album' && <AlbumTab event={event} />}
          {tab === 'display' && <DisplayTab event={event} />}
          {tab === 'share' && <ShareTab event={event} />}
        </div>
      </section>
    );
  }
  ```
- [ ] Create minimal stubs (replaced in Tasks 6–8) so the file compiles: `web/src/admin/event/AlbumTab.tsx`, `DisplayTab.tsx`, `ShareTab.tsx`, each `import type { EventDetail } from '@rtpa/shared'; export function AlbumTab({ event }: { event: EventDetail }) { return <div /> }` (rename per file). These are overwritten in their own tasks.
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/EventDetailPage.test.tsx` and expect **PASS**.
- [ ] Commit: `feat(web): admin event detail shell with tabs`.

---

## Task 6 — QR & Share tab

**Files:**
- `web/src/admin/event/ShareTab.tsx` (new — replaces stub)
- `web/src/admin/__tests__/ShareTab.test.tsx` (new)

The upload link is `publicBaseUrl + '/e/' + code`. `publicBaseUrl` comes from `adminApi.getSettings()`.

- [ ] Write FAILING test `web/src/admin/__tests__/ShareTab.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { ShareTab } from '../event/ShareTab';
  import { renderWithProviders } from './helpers/renderWithProviders';
  import { DEFAULT_MOTION_CONFIG, DEFAULT_MEDIA_LIMITS } from '@rtpa/shared';
  import type { EventDetail } from '@rtpa/shared';

  vi.mock('../api', () => ({
    adminApi: {
      getSettings: vi.fn(),
      qrUrl: (id: string) => `/api/admin/events/${id}/qr`,
      setUploadState: vi.fn(),
      endEvent: vi.fn(),
    },
  }));
  import { adminApi } from '../api';

  const event: EventDetail = {
    id: 'e1', code: 'ABCD', name: 'Sara', createdAt: '2026-06-01T12:00:00.000Z',
    isActive: true, uploadEnabled: true, status: 'active', themeId: 'preset-midnight-gala',
    photoCount: 3, motionConfig: DEFAULT_MOTION_CONFIG,
  };

  describe('ShareTab', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (adminApi.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        publicBaseUrl: 'https://party.test', mediaLimits: DEFAULT_MEDIA_LIMITS,
      });
      (adminApi.setUploadState as ReturnType<typeof vi.fn>).mockResolvedValue({ ...event, uploadEnabled: false });
      (adminApi.endEvent as ReturnType<typeof vi.fn>).mockResolvedValue({ ...event, status: 'ended' });
    });

    it('shows upload link and qr image', async () => {
      renderWithProviders(<ShareTab event={event} />);
      expect(await screen.findByText('https://party.test/e/ABCD')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: /qr/i })).toHaveAttribute('src', '/api/admin/events/e1/qr');
    });

    it('print button calls window.print', async () => {
      const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
      renderWithProviders(<ShareTab event={event} />);
      await screen.findByText('https://party.test/e/ABCD');
      await userEvent.click(screen.getByRole('button', { name: /print/i }));
      expect(printSpy).toHaveBeenCalled();
    });

    it('pause toggle calls setUploadState with false', async () => {
      renderWithProviders(<ShareTab event={event} />);
      await screen.findByText('https://party.test/e/ABCD');
      await userEvent.click(screen.getByRole('button', { name: /pause uploads/i }));
      await waitFor(() => expect(adminApi.setUploadState).toHaveBeenCalledWith('e1', false));
    });

    it('end event confirms then calls endEvent', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderWithProviders(<ShareTab event={event} />);
      await screen.findByText('https://party.test/e/ABCD');
      await userEvent.click(screen.getByRole('button', { name: /end event/i }));
      await waitFor(() => expect(adminApi.endEvent).toHaveBeenCalledWith('e1'));
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/ShareTab.test.tsx` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/event/ShareTab.tsx`:
  ```tsx
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
  import { adminApi } from '../api';
  import type { EventDetail } from '@rtpa/shared';

  export function ShareTab({ event }: { event: EventDetail }) {
    const qc = useQueryClient();
    const { data: settings } = useQuery({
      queryKey: ['admin', 'settings'],
      queryFn: () => adminApi.getSettings(),
    });
    const baseUrl = settings?.publicBaseUrl ?? '';
    const uploadLink = `${baseUrl}/e/${event.code}`;

    const invalidateEvent = () =>
      qc.invalidateQueries({ queryKey: ['admin', 'event', event.id] });

    const uploadStateMut = useMutation({
      mutationFn: (enabled: boolean) => adminApi.setUploadState(event.id, enabled),
      onSuccess: () => { void invalidateEvent(); },
    });
    const endMut = useMutation({
      mutationFn: () => adminApi.endEvent(event.id),
      onSuccess: () => { void invalidateEvent(); },
    });

    function copyLink() {
      void navigator.clipboard?.writeText(uploadLink);
    }

    return (
      <div className="share-tab">
        <h2>Share &amp; QR</h2>
        <p className="upload-link">{uploadLink}</p>
        <button type="button" onClick={copyLink}>Copy link</button>
        <img src={adminApi.qrUrl(event.id)} alt={`QR code for ${event.name}`} />
        <button type="button" onClick={() => window.print()}>Print</button>

        <div className="upload-toggle">
          {event.uploadEnabled ? (
            <button type="button" onClick={() => uploadStateMut.mutate(false)} disabled={uploadStateMut.isPending}>
              Pause uploads
            </button>
          ) : (
            <button type="button" onClick={() => uploadStateMut.mutate(true)} disabled={uploadStateMut.isPending}>
              Resume uploads
            </button>
          )}
        </div>

        <button
          type="button"
          className="danger"
          disabled={event.status === 'ended' || endMut.isPending}
          onClick={() => { if (window.confirm('End this event? Uploads will be closed.')) endMut.mutate(); }}
        >
          End event
        </button>
      </div>
    );
  }
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/ShareTab.test.tsx` and expect **PASS**.
- [ ] Commit: `feat(web): admin share tab (qr, link, pause/resume, end)`.

---

## Task 7 — Album manager tab (live-updating, moderation, bulk, filter)

**Files:**
- `web/src/admin/event/AlbumTab.tsx` (new — replaces stub)
- `web/src/admin/__tests__/AlbumTab.test.tsx` (new)

The socket is obtained via the Plan-4 helper `getSocket()` from `src/lib/socket.ts`; the test mocks that module to return a fake socket from Task 0. On mount the component emits `join` with `event.code` and registers `photo:added`/`photo:hidden`/`photo:deleted` handlers, cleaning up on unmount.

- [ ] Write FAILING test `web/src/admin/__tests__/AlbumTab.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { screen, waitFor, within } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { AlbumTab } from '../event/AlbumTab';
  import { renderWithProviders } from './helpers/renderWithProviders';
  import { createFakeSocket, FakeSocket } from './helpers/fakeSocket';
  import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';
  import type { EventDetail, PhotoAdmin, Photo } from '@rtpa/shared';

  let fakeSocket: FakeSocket;
  vi.mock('../../lib/socket', () => ({ getSocket: () => fakeSocket }));
  vi.mock('../api', () => ({
    adminApi: { listPhotos: vi.fn(), hidePhoto: vi.fn(), deletePhoto: vi.fn() },
  }));
  import { adminApi } from '../api';

  const event: EventDetail = {
    id: 'e1', code: 'ABCD', name: 'Sara', createdAt: '2026-06-01T12:00:00.000Z',
    isActive: true, uploadEnabled: true, status: 'active', themeId: 'preset-midnight-gala',
    photoCount: 2, motionConfig: DEFAULT_MOTION_CONFIG,
  };
  function mkPhoto(id: string, createdAt: string, name = 'Guest'): PhotoAdmin {
    return {
      id, eventId: 'e1', uploaderName: name, mediaType: 'image', width: 800, height: 600,
      durationMs: null, createdAt, isHidden: false,
      displayUrl: `/media/display/${id}.jpg`, thumbUrl: `/media/thumb/${id}.jpg`,
      deviceId: `dev-${id}`, userAgent: 'UA', ipAddress: '1.2.3.4',
    };
  }
  const older = mkPhoto('p1', '2026-06-01T10:00:00.000Z', 'Alice');
  const newer = mkPhoto('p2', '2026-06-01T11:00:00.000Z', 'Bob');

  describe('AlbumTab', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      fakeSocket = createFakeSocket();
      (adminApi.listPhotos as ReturnType<typeof vi.fn>).mockResolvedValue([newer, older]); // newest-first
      (adminApi.hidePhoto as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (adminApi.deletePhoto as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    it('renders grid newest-first and joins room', async () => {
      renderWithProviders(<AlbumTab event={event} />);
      await screen.findByText('Bob');
      const tiles = screen.getAllByTestId('photo-tile');
      expect(tiles[0]).toHaveAttribute('data-photo-id', 'p2');
      expect(tiles[1]).toHaveAttribute('data-photo-id', 'p1');
      expect(fakeSocket.emitted).toContainEqual(['join', 'ABCD']);
    });

    it('photo:added prepends new tile', async () => {
      renderWithProviders(<AlbumTab event={event} />);
      await screen.findByText('Bob');
      const incoming: Photo = {
        id: 'p3', eventId: 'e1', uploaderName: 'Cara', mediaType: 'image', width: 1, height: 1,
        durationMs: null, createdAt: '2026-06-01T12:30:00.000Z', isHidden: false,
        displayUrl: '/media/display/p3.jpg', thumbUrl: '/media/thumb/p3.jpg',
      };
      fakeSocket.emitServer('photo:added', incoming);
      await screen.findByText('Cara');
      const tiles = screen.getAllByTestId('photo-tile');
      expect(tiles[0]).toHaveAttribute('data-photo-id', 'p3');
    });

    it('hide calls api and marks tile hidden', async () => {
      renderWithProviders(<AlbumTab event={event} />);
      await screen.findByText('Bob');
      const tile = screen.getByTestId('photo-tile-p2');
      await userEvent.click(within(tile).getByRole('button', { name: /^hide$/i }));
      await waitFor(() => expect(adminApi.hidePhoto).toHaveBeenCalledWith('p2', true));
    });

    it('photo:deleted removes tile', async () => {
      renderWithProviders(<AlbumTab event={event} />);
      await screen.findByText('Bob');
      fakeSocket.emitServer('photo:deleted', { id: 'p1' });
      await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
    });

    it('bulk delete confirms and deletes selected', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderWithProviders(<AlbumTab event={event} />);
      await screen.findByText('Bob');
      await userEvent.click(within(screen.getByTestId('photo-tile-p1')).getByRole('checkbox'));
      await userEvent.click(within(screen.getByTestId('photo-tile-p2')).getByRole('checkbox'));
      await userEvent.click(screen.getByRole('button', { name: /delete selected/i }));
      await waitFor(() => expect(adminApi.deletePhoto).toHaveBeenCalledWith('p1'));
      expect(adminApi.deletePhoto).toHaveBeenCalledWith('p2');
    });

    it('show-hidden filter toggles visibility of hidden tiles', async () => {
      const hidden = { ...older, isHidden: true };
      (adminApi.listPhotos as ReturnType<typeof vi.fn>).mockResolvedValue([newer, hidden]);
      renderWithProviders(<AlbumTab event={event} />);
      await screen.findByText('Bob');
      // default hides the hidden tile
      expect(screen.queryByTestId('photo-tile-p1')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('checkbox', { name: /show hidden/i }));
      expect(screen.getByTestId('photo-tile-p1')).toBeInTheDocument();
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/AlbumTab.test.tsx` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/event/AlbumTab.tsx`:
  ```tsx
  import { useEffect, useMemo, useState } from 'react';
  import { useQuery } from '@tanstack/react-query';
  import { adminApi } from '../api';
  import { getSocket } from '../../lib/socket';
  import type { EventDetail, PhotoAdmin, Photo } from '@rtpa/shared';

  function mergePhotoFromSocket(prev: PhotoAdmin[], p: Photo): PhotoAdmin[] {
    const existing = prev.find((x) => x.id === p.id);
    if (existing) {
      return prev.map((x) => (x.id === p.id ? { ...x, ...p, isHidden: false } : x));
    }
    const admin: PhotoAdmin = { ...p, deviceId: '', userAgent: '', ipAddress: '' };
    return [admin, ...prev];
  }

  export function AlbumTab({ event }: { event: EventDetail }) {
    const { data, isLoading } = useQuery({
      queryKey: ['admin', 'photos', event.id],
      queryFn: () => adminApi.listPhotos(event.id),
    });

    const [photos, setPhotos] = useState<PhotoAdmin[]>([]);
    const [showHidden, setShowHidden] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [openInfo, setOpenInfo] = useState<string | null>(null);

    useEffect(() => { if (data) setPhotos(data); }, [data]);

    useEffect(() => {
      const socket = getSocket();
      socket.emit('join', event.code);
      const onAdded = (p: Photo) => setPhotos((prev) => mergePhotoFromSocket(prev, p));
      const onHidden = (payload: { id: string }) =>
        setPhotos((prev) => prev.map((x) => (x.id === payload.id ? { ...x, isHidden: true } : x)));
      const onDeleted = (payload: { id: string }) =>
        setPhotos((prev) => prev.filter((x) => x.id !== payload.id));
      socket.on('photo:added', onAdded);
      socket.on('photo:hidden', onHidden);
      socket.on('photo:deleted', onDeleted);
      return () => {
        socket.off('photo:added', onAdded);
        socket.off('photo:hidden', onHidden);
        socket.off('photo:deleted', onDeleted);
      };
    }, [event.code]);

    const visible = useMemo(
      () => photos.filter((p) => (showHidden ? true : !p.isHidden)),
      [photos, showHidden],
    );

    function toggleSelect(id: string) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }

    async function hide(id: string, hidden: boolean) {
      await adminApi.hidePhoto(id, hidden);
      setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, isHidden: hidden } : x)));
    }
    async function remove(id: string) {
      await adminApi.deletePhoto(id);
      setPhotos((prev) => prev.filter((x) => x.id !== id));
    }

    async function bulkHide() {
      const ids = [...selected];
      for (const id of ids) await hide(id, true);
      setSelected(new Set());
    }
    async function bulkDelete() {
      if (!window.confirm(`Delete ${selected.size} photos?`)) return;
      const ids = [...selected];
      for (const id of ids) await remove(id);
      setSelected(new Set());
    }

    if (isLoading) return <p>Loading…</p>;

    return (
      <div className="album-tab">
        <div className="album-toolbar">
          <label>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Show hidden
          </label>
          <button type="button" disabled={selected.size === 0} onClick={() => void bulkHide()}>Hide selected</button>
          <button type="button" disabled={selected.size === 0} onClick={() => void bulkDelete()}>Delete selected</button>
        </div>
        <ul className="photo-grid">
          {visible.map((p) => (
            <li
              key={p.id}
              data-testid="photo-tile"
              data-photo-id={p.id}
              data-testid-id={`photo-tile-${p.id}`}
              id={`photo-tile-${p.id}`}
              className={p.isHidden ? 'tile hidden' : 'tile'}
            >
              <input
                type="checkbox"
                aria-label={`select ${p.uploaderName}`}
                checked={selected.has(p.id)}
                onChange={() => toggleSelect(p.id)}
              />
              <img src={p.thumbUrl} alt={p.uploaderName} />
              <span className="uploader">{p.uploaderName}</span>
              <time>{new Date(p.createdAt).toLocaleTimeString()}</time>
              <button type="button" onClick={() => setOpenInfo(openInfo === p.id ? null : p.id)}>Info</button>
              {openInfo === p.id && (
                <div className="popover" role="dialog">
                  <p>device: {p.deviceId}</p>
                  <p>ua: {p.userAgent}</p>
                  <p>ip: {p.ipAddress}</p>
                </div>
              )}
              {p.isHidden ? (
                <button type="button" onClick={() => void hide(p.id, false)}>Unhide</button>
              ) : (
                <button type="button" onClick={() => void hide(p.id, true)}>Hide</button>
              )}
              <button
                type="button"
                onClick={() => { if (window.confirm('Delete this photo?')) void remove(p.id); }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  ```
  Note: `data-testid` must be unique per query expectation. The test uses both `getAllByTestId('photo-tile')` and `getByTestId('photo-tile-p2')`. A DOM node may not carry two `data-testid` values. Resolve by giving the `<li>` `data-testid="photo-tile"` and adding the per-id selector via a nested wrapper: wrap each tile body in an inner `<div data-testid={`photo-tile-${p.id}`}>`. Adjust the JSX so the `<li>` has `data-testid="photo-tile" data-photo-id={p.id}` and its first child is `<div data-testid={`photo-tile-${p.id}`}> … </div>`. Remove the invalid `data-testid-id`/duplicate `id` attributes. (`within(getByTestId('photo-tile-p2'))` then scopes to that tile's controls.)
- [ ] Apply that fix in `AlbumTab.tsx`: `<li key={p.id} data-testid="photo-tile" data-photo-id={p.id} className={…}><div data-testid={`photo-tile-${p.id}`}> …all tile contents… </div></li>`.
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/AlbumTab.test.tsx` and expect **PASS**.
- [ ] Commit: `feat(web): live album manager with moderation, bulk, filter`.

---

## Task 8 — Display settings tab (full MotionConfig)

**Files:**
- `web/src/admin/event/DisplayTab.tsx` (new — replaces stub)
- `web/src/admin/event/useDebouncedCallback.ts` (new — tiny reusable debounce hook)
- `web/src/admin/__tests__/DisplayTab.test.tsx` (new)

Debounced `PUT motion` on any change. "Open display" opens `/e/:code/display` via `window.open`.

- [ ] Write FAILING test `web/src/admin/__tests__/DisplayTab.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { screen, waitFor } from '@testing-library/react';
  import { fireEvent } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { DisplayTab } from '../event/DisplayTab';
  import { renderWithProviders } from './helpers/renderWithProviders';
  import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';
  import type { EventDetail } from '@rtpa/shared';

  vi.mock('../api', () => ({ adminApi: { setMotion: vi.fn() } }));
  import { adminApi } from '../api';

  const event: EventDetail = {
    id: 'e1', code: 'ABCD', name: 'Sara', createdAt: '2026-06-01T12:00:00.000Z',
    isActive: true, uploadEnabled: true, status: 'active', themeId: 'preset-midnight-gala',
    photoCount: 0, motionConfig: DEFAULT_MOTION_CONFIG,
  };

  describe('DisplayTab', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers();
      (adminApi.setMotion as ReturnType<typeof vi.fn>).mockResolvedValue(event);
    });
    afterEach(() => vi.useRealTimers());

    it('changing speed issues debounced PUT with updated MotionConfig', async () => {
      renderWithProviders(<DisplayTab event={event} />);
      const speed = screen.getByLabelText(/overall speed/i) as HTMLInputElement;
      fireEvent.change(speed, { target: { value: '2' } });
      vi.advanceTimersByTime(400);
      await waitFor(() => expect(adminApi.setMotion).toHaveBeenCalledTimes(1));
      const [id, cfg] = (adminApi.setMotion as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(id).toBe('e1');
      expect(cfg.speed).toBe(2);
      expect(cfg.maxOnCanvas).toBe(DEFAULT_MOTION_CONFIG.maxOnCanvas);
    });

    it('changing maxOnCanvas PUTs updated cap', async () => {
      renderWithProviders(<DisplayTab event={event} />);
      const max = screen.getByLabelText(/max on canvas/i) as HTMLInputElement;
      fireEvent.change(max, { target: { value: '30' } });
      vi.advanceTimersByTime(400);
      await waitFor(() => expect(adminApi.setMotion).toHaveBeenCalled());
      const cfg = (adminApi.setMotion as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
      expect(cfg.maxOnCanvas).toBe(30);
    });

    it('dwell toggle updates dwell.enabled', async () => {
      renderWithProviders(<DisplayTab event={event} />);
      const toggle = screen.getByLabelText(/dwell timeout enabled/i);
      fireEvent.click(toggle);
      vi.advanceTimersByTime(400);
      await waitFor(() => expect(adminApi.setMotion).toHaveBeenCalled());
      const cfg = (adminApi.setMotion as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
      expect(cfg.dwell.enabled).toBe(false);
    });

    it('open display opens /e/:code/display', async () => {
      vi.useRealTimers();
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      renderWithProviders(<DisplayTab event={event} />);
      await userEvent.click(screen.getByRole('button', { name: /open display/i }));
      expect(openSpy).toHaveBeenCalledWith('/e/ABCD/display', '_blank', 'noopener');
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/DisplayTab.test.tsx` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/event/useDebouncedCallback.ts`:
  ```ts
  import { useEffect, useRef, useCallback } from 'react';

  export function useDebouncedCallback<A extends unknown[]>(
    fn: (...args: A) => void,
    delayMs: number,
  ): (...args: A) => void {
    const fnRef = useRef(fn);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => { fnRef.current = fn; }, [fn]);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    return useCallback((...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fnRef.current(...args), delayMs);
    }, [delayMs]);
  }
  ```
- [ ] COMPLETE `web/src/admin/event/DisplayTab.tsx`:
  ```tsx
  import { useState } from 'react';
  import { adminApi } from '../api';
  import { useDebouncedCallback } from './useDebouncedCallback';
  import type {
    EventDetail, MotionConfig, MotionStyle, EnterAnimation, LeaveAnimation,
  } from '@rtpa/shared';

  const MOTION_STYLES: MotionStyle[] = ['drift', 'current', 'orbit', 'mosaic'];
  const ENTER_ANIMS: EnterAnimation[] = ['flyInEdge', 'scalePop', 'fadeGrow', 'spinIn', 'dropBounce'];
  const LEAVE_ANIMS: LeaveAnimation[] = ['driftOffEdge', 'shrinkFade', 'spinOut', 'slideAway'];

  export function DisplayTab({ event }: { event: EventDetail }) {
    const [config, setConfig] = useState<MotionConfig>(event.motionConfig);
    const pushConfig = useDebouncedCallback((cfg: MotionConfig) => {
      void adminApi.setMotion(event.id, cfg);
    }, 350);

    function update(next: MotionConfig) {
      setConfig(next);
      pushConfig(next);
    }

    return (
      <div className="display-tab">
        <h2>Display settings</h2>

        <fieldset>
          <legend>Motion-style mix</legend>
          {MOTION_STYLES.map((s) => (
            <label key={s}>
              {s}
              <input
                type="range" min={0} max={10} step={1} value={config.motionWeights[s]}
                aria-label={`motion weight ${s}`}
                onChange={(e) => update({ ...config, motionWeights: { ...config.motionWeights, [s]: Number(e.target.value) } })}
              />
            </label>
          ))}
        </fieldset>

        <label>
          Overall speed
          <input
            type="range" min={0.25} max={3} step={0.25} value={config.speed}
            aria-label="overall speed"
            onChange={(e) => update({ ...config, speed: Number(e.target.value) })}
          />
        </label>

        <label>
          Max on canvas
          <input
            type="number" min={1} max={200} value={config.maxOnCanvas}
            aria-label="max on canvas"
            onChange={(e) => update({ ...config, maxOnCanvas: Number(e.target.value) })}
          />
        </label>

        <fieldset>
          <legend>Dwell timeout</legend>
          <label>
            Dwell timeout enabled
            <input
              type="checkbox" checked={config.dwell.enabled}
              onChange={(e) => update({ ...config, dwell: { ...config.dwell, enabled: e.target.checked } })}
            />
          </label>
          <label>
            Dwell duration (ms)
            <input
              type="number" min={1000} step={1000} value={config.dwell.durationMs}
              aria-label="dwell duration"
              onChange={(e) => update({ ...config, dwell: { ...config.dwell, durationMs: Number(e.target.value) } })}
            />
          </label>
          <label>
            Dwell variance (ms)
            <input
              type="number" min={0} step={1000} value={config.dwell.varianceMs}
              aria-label="dwell variance"
              onChange={(e) => update({ ...config, dwell: { ...config.dwell, varianceMs: Number(e.target.value) } })}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Enter-animation weights</legend>
          {ENTER_ANIMS.map((a) => (
            <label key={a}>
              {a}
              <input
                type="range" min={0} max={10} step={1} value={config.enterWeights[a]}
                aria-label={`enter weight ${a}`}
                onChange={(e) => update({ ...config, enterWeights: { ...config.enterWeights, [a]: Number(e.target.value) } })}
              />
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Leave-animation weights</legend>
          {LEAVE_ANIMS.map((a) => (
            <label key={a}>
              {a}
              <input
                type="range" min={0} max={10} step={1} value={config.leaveWeights[a]}
                aria-label={`leave weight ${a}`}
                onChange={(e) => update({ ...config, leaveWeights: { ...config.leaveWeights, [a]: Number(e.target.value) } })}
              />
            </label>
          ))}
        </fieldset>

        <label>
          Base size
          <input
            type="range" min={80} max={480} step={10} value={config.baseSize}
            aria-label="base size"
            onChange={(e) => update({ ...config, baseSize: Number(e.target.value) })}
          />
        </label>

        <label>
          Size variance
          <input
            type="range" min={0} max={1} step={0.05} value={config.sizeVariance}
            aria-label="size variance"
            onChange={(e) => update({ ...config, sizeVariance: Number(e.target.value) })}
          />
        </label>

        <button
          type="button"
          onClick={() => window.open(`/e/${event.code}/display`, '_blank', 'noopener')}
        >
          Open display
        </button>
      </div>
    );
  }
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/DisplayTab.test.tsx` and expect **PASS**.
- [ ] Commit: `feat(web): display settings tab with debounced motion config PUT`.

---

## Task 9 — Theme builder + per-event theme selection

**Files:**
- `web/src/admin/ThemesPage.tsx` (new — replaces stub)
- `web/src/admin/ThemeEditor.tsx` (new)
- `web/src/admin/event/ThemeSelect.tsx` (new — per-event theme control surfaced on DisplayTab)
- `web/src/admin/__tests__/ThemeEditor.test.tsx` (new)
- `web/src/admin/__tests__/ThemesPage.test.tsx` (new)
- `web/src/admin/event/DisplayTab.tsx` (MODIFY — mount `<ThemeSelect>`)

Live preview reuses `themeVars`/`frameStyle` from `src/lib/themeCss.ts`. Presets are read-only: their Delete is disabled and Save is replaced by Duplicate.

- [ ] Write FAILING test `web/src/admin/__tests__/ThemeEditor.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { screen, waitFor } from '@testing-library/react';
  import { fireEvent } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { ThemeEditor } from '../ThemeEditor';
  import { renderWithProviders } from './helpers/renderWithProviders';
  import type { Theme, ThemeTokens } from '@rtpa/shared';

  vi.mock('../api', () => ({ adminApi: { updateTheme: vi.fn(), createTheme: vi.fn() } }));
  import { adminApi } from '../api';

  const tokens: ThemeTokens = {
    background: { type: 'solid', value: '#101018' },
    ambient: 'glow',
    frame: { style: 'thin', borderColor: '#ffffff', borderWidth: 2, radius: 8, shadow: true },
    caption: { enabled: true, bg: '#000000', color: '#ffffff' },
    font: 'Inter', accent: '#e0b3ff',
  };
  const custom: Theme = { id: 't-custom', name: 'My Theme', isPreset: false, tokens };
  const preset: Theme = { id: 'preset-neon-night', name: 'Neon Night', isPreset: true, tokens };

  describe('ThemeEditor', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (adminApi.updateTheme as ReturnType<typeof vi.fn>).mockResolvedValue(custom);
    });

    it('editing accent updates the live preview', async () => {
      renderWithProviders(<ThemeEditor theme={custom} onSaved={vi.fn()} />);
      const accent = screen.getByLabelText(/accent/i) as HTMLInputElement;
      fireEvent.change(accent, { target: { value: '#00ff00' } });
      const preview = screen.getByTestId('theme-preview');
      await waitFor(() =>
        expect(preview.style.getPropertyValue('--accent')).toBe('#00ff00'),
      );
    });

    it('save on custom calls updateTheme with tokens', async () => {
      const onSaved = vi.fn();
      renderWithProviders(<ThemeEditor theme={custom} onSaved={onSaved} />);
      fireEvent.change(screen.getByLabelText(/border width/i), { target: { value: '6' } });
      await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() => expect(adminApi.updateTheme).toHaveBeenCalled());
      const [id, input] = (adminApi.updateTheme as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(id).toBe('t-custom');
      expect(input.tokens.frame.borderWidth).toBe(6);
      expect(onSaved).toHaveBeenCalled();
    });

    it('preset shows Duplicate instead of Save, no Delete', () => {
      renderWithProviders(<ThemeEditor theme={preset} onSaved={vi.fn()} />);
      expect(screen.getByRole('button', { name: /duplicate/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/ThemeEditor.test.tsx` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/ThemeEditor.tsx` (assumes `themeVars(tokens): React.CSSProperties` emits CSS custom props including `--accent`, and `frameStyle(tokens)` returns the tile frame style; both from `src/lib/themeCss.ts`):
  ```tsx
  import { useState } from 'react';
  import { adminApi } from './api';
  import { themeVars, frameStyle } from '../lib/themeCss';
  import type { Theme, ThemeTokens } from '@rtpa/shared';

  const SAMPLE = [
    { name: 'Alice', src: '/media/thumb/sample1.jpg' },
    { name: 'Bob', src: '/media/thumb/sample2.jpg' },
    { name: 'Cara', src: '/media/thumb/sample3.jpg' },
  ];

  export function ThemeEditor({ theme, onSaved }: { theme: Theme; onSaved: (t: Theme) => void }) {
    const [name, setName] = useState(theme.name);
    const [tokens, setTokens] = useState<ThemeTokens>(theme.tokens);
    const [busy, setBusy] = useState(false);
    const readOnly = theme.isPreset;

    function setBackground(patch: Partial<ThemeTokens['background']>) {
      setTokens({ ...tokens, background: { ...tokens.background, ...patch } });
    }
    function setFrame(patch: Partial<ThemeTokens['frame']>) {
      setTokens({ ...tokens, frame: { ...tokens.frame, ...patch } });
    }
    function setCaption(patch: Partial<ThemeTokens['caption']>) {
      setTokens({ ...tokens, caption: { ...tokens.caption, ...patch } });
    }

    async function save() {
      setBusy(true);
      try {
        const saved = await adminApi.updateTheme(theme.id, { name, tokens });
        onSaved(saved);
      } finally { setBusy(false); }
    }
    async function duplicate() {
      setBusy(true);
      try {
        const created = await adminApi.createTheme(`${name} (copy)`, tokens);
        onSaved(created);
      } finally { setBusy(false); }
    }

    return (
      <div className="theme-editor">
        <div className="editor-controls">
          <label>Name<input value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} /></label>

          <label>Background type
            <select value={tokens.background.type} onChange={(e) => setBackground({ type: e.target.value as ThemeTokens['background']['type'] })}>
              <option value="solid">solid</option>
              <option value="gradient">gradient</option>
              <option value="image">image</option>
            </select>
          </label>
          <label>Background value<input value={tokens.background.value} onChange={(e) => setBackground({ value: e.target.value })} /></label>

          <label>Ambient
            <select value={tokens.ambient} onChange={(e) => setTokens({ ...tokens, ambient: e.target.value as ThemeTokens['ambient'] })}>
              <option value="none">none</option>
              <option value="bokeh">bokeh</option>
              <option value="particles">particles</option>
              <option value="glow">glow</option>
            </select>
          </label>

          <label>Frame style
            <select value={tokens.frame.style} onChange={(e) => setFrame({ style: e.target.value as ThemeTokens['frame']['style'] })}>
              <option value="thin">thin</option>
              <option value="polaroid">polaroid</option>
              <option value="rounded">rounded</option>
              <option value="none">none</option>
            </select>
          </label>
          <label>Border color<input type="color" value={tokens.frame.borderColor} onChange={(e) => setFrame({ borderColor: e.target.value })} /></label>
          <label>Border width<input type="number" min={0} max={40} value={tokens.frame.borderWidth} onChange={(e) => setFrame({ borderWidth: Number(e.target.value) })} /></label>
          <label>Radius<input type="number" min={0} max={64} value={tokens.frame.radius} onChange={(e) => setFrame({ radius: Number(e.target.value) })} /></label>
          <label>Shadow<input type="checkbox" checked={tokens.frame.shadow} onChange={(e) => setFrame({ shadow: e.target.checked })} /></label>

          <label>Caption enabled<input type="checkbox" checked={tokens.caption.enabled} onChange={(e) => setCaption({ enabled: e.target.checked })} /></label>
          <label>Caption bg<input type="color" value={tokens.caption.bg} onChange={(e) => setCaption({ bg: e.target.value })} /></label>
          <label>Caption color<input type="color" value={tokens.caption.color} onChange={(e) => setCaption({ color: e.target.value })} /></label>

          <label>Font<input value={tokens.font} onChange={(e) => setTokens({ ...tokens, font: e.target.value })} /></label>
          <label>Accent<input type="color" value={tokens.accent} onChange={(e) => setTokens({ ...tokens, accent: e.target.value })} /></label>

          {readOnly ? (
            <button type="button" disabled={busy} onClick={() => void duplicate()}>Duplicate</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void save()}>Save</button>
          )}
        </div>

        <div className="theme-preview" data-testid="theme-preview" style={themeVars(tokens)}>
          {SAMPLE.map((s) => (
            <figure key={s.name} style={frameStyle(tokens)}>
              <img src={s.src} alt={s.name} />
              {tokens.caption.enabled && (
                <figcaption style={{ background: tokens.caption.bg, color: tokens.caption.color }}>{s.name}</figcaption>
              )}
            </figure>
          ))}
        </div>
      </div>
    );
  }
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/ThemeEditor.test.tsx` and expect **PASS**.
- [ ] Write FAILING test `web/src/admin/__tests__/ThemesPage.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { ThemesPage } from '../ThemesPage';
  import { renderWithProviders } from './helpers/renderWithProviders';
  import type { Theme, ThemeTokens } from '@rtpa/shared';

  vi.mock('../api', () => ({
    adminApi: { listThemes: vi.fn(), createTheme: vi.fn(), deleteTheme: vi.fn(), updateTheme: vi.fn() },
  }));
  import { adminApi } from '../api';

  const tokens: ThemeTokens = {
    background: { type: 'solid', value: '#101018' }, ambient: 'glow',
    frame: { style: 'thin', borderColor: '#fff', borderWidth: 2, radius: 8, shadow: true },
    caption: { enabled: true, bg: '#000', color: '#fff' }, font: 'Inter', accent: '#e0b3ff',
  };
  const preset: Theme = { id: 'preset-neon-night', name: 'Neon Night', isPreset: true, tokens };
  const custom: Theme = { id: 't1', name: 'Mine', isPreset: false, tokens };

  describe('ThemesPage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (adminApi.listThemes as ReturnType<typeof vi.fn>).mockResolvedValue([preset, custom]);
      (adminApi.createTheme as ReturnType<typeof vi.fn>).mockResolvedValue({ ...custom, id: 't2', name: 'Neon Night (copy)' });
      (adminApi.deleteTheme as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    it('lists presets and custom themes', async () => {
      renderWithProviders(<ThemesPage />);
      expect(await screen.findByText('Neon Night')).toBeInTheDocument();
      expect(screen.getByText('Mine')).toBeInTheDocument();
    });

    it('delete is disabled for presets', async () => {
      renderWithProviders(<ThemesPage />);
      await screen.findByText('Neon Night');
      const row = screen.getByTestId('theme-row-preset-neon-night');
      expect(row.querySelector('button[data-action="delete"]')).toBeDisabled();
    });

    it('duplicate a preset calls createTheme from its tokens', async () => {
      renderWithProviders(<ThemesPage />);
      await screen.findByText('Neon Night');
      const row = screen.getByTestId('theme-row-preset-neon-night');
      await userEvent.click(row.querySelector('button[data-action="duplicate"]')!);
      await waitFor(() => expect(adminApi.createTheme).toHaveBeenCalledWith('Neon Night (copy)', tokens));
    });

    it('delete custom calls deleteTheme', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderWithProviders(<ThemesPage />);
      await screen.findByText('Mine');
      const row = screen.getByTestId('theme-row-t1');
      await userEvent.click(row.querySelector('button[data-action="delete"]')!);
      await waitFor(() => expect(adminApi.deleteTheme).toHaveBeenCalledWith('t1'));
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/ThemesPage.test.tsx` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/ThemesPage.tsx`:
  ```tsx
  import { useState } from 'react';
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
  import { adminApi } from './api';
  import { ThemeEditor } from './ThemeEditor';
  import type { Theme } from '@rtpa/shared';

  export function ThemesPage() {
    const qc = useQueryClient();
    const [editing, setEditing] = useState<Theme | null>(null);
    const { data: themes } = useQuery({ queryKey: ['admin', 'themes'], queryFn: () => adminApi.listThemes() });

    const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'themes'] });

    const dupMut = useMutation({
      mutationFn: (t: Theme) => adminApi.createTheme(`${t.name} (copy)`, t.tokens),
      onSuccess: (created) => { void invalidate(); setEditing(created); },
    });
    const delMut = useMutation({
      mutationFn: (id: string) => adminApi.deleteTheme(id),
      onSuccess: () => { void invalidate(); setEditing(null); },
    });

    return (
      <section className="themes-page">
        <h1>Themes</h1>
        <ul className="theme-list">
          {(themes ?? []).map((t) => (
            <li key={t.id} data-testid={`theme-row-${t.id}`}>
              <button type="button" data-action="edit" onClick={() => setEditing(t)}>{t.name}</button>
              {t.isPreset && <span className="badge">preset</span>}
              <button type="button" data-action="duplicate" onClick={() => dupMut.mutate(t)}>Duplicate</button>
              <button
                type="button"
                data-action="delete"
                disabled={t.isPreset}
                onClick={() => { if (window.confirm(`Delete theme "${t.name}"?`)) delMut.mutate(t.id); }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        {editing && (
          <ThemeEditor
            theme={editing}
            onSaved={(saved) => { void invalidate(); setEditing(saved); }}
          />
        )}
      </section>
    );
  }
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/ThemesPage.test.tsx` and expect **PASS**.
- [ ] COMPLETE `web/src/admin/event/ThemeSelect.tsx` (per-event theme selection control; PUT `:id/theme`):
  ```tsx
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
  import { adminApi } from '../api';
  import type { EventDetail } from '@rtpa/shared';

  export function ThemeSelect({ event }: { event: EventDetail }) {
    const qc = useQueryClient();
    const { data: themes } = useQuery({ queryKey: ['admin', 'themes'], queryFn: () => adminApi.listThemes() });
    const mut = useMutation({
      mutationFn: (themeId: string) => adminApi.setEventTheme(event.id, themeId),
      onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'event', event.id] }); },
    });
    return (
      <label>
        Event theme
        <select aria-label="event theme" value={event.themeId} onChange={(e) => mut.mutate(e.target.value)}>
          {(themes ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.name}{t.isPreset ? ' (preset)' : ''}</option>
          ))}
        </select>
      </label>
    );
  }
  ```
- [ ] MODIFY `web/src/admin/event/DisplayTab.tsx`: import `ThemeSelect` and render `<ThemeSelect event={event} />` just under the `<h2>Display settings</h2>` heading. Add `import { ThemeSelect } from './ThemeSelect';` at the top. (The existing DisplayTab test still passes — it does not assert on the theme select; `adminApi.listThemes` is unmocked there but the query is lazy and any rejection is swallowed by react-query with `retry:false`, so no assertion breaks. If the DisplayTab test now imports through ThemeSelect's `listThemes`, add `listThemes: vi.fn().mockResolvedValue([])` to that test's `adminApi` mock.)
- [ ] Update `web/src/admin/__tests__/DisplayTab.test.tsx` mock to `vi.mock('../api', () => ({ adminApi: { setMotion: vi.fn(), setEventTheme: vi.fn(), listThemes: vi.fn().mockResolvedValue([]) } }))` and re-run `npm test -w @rtpa/web -- src/admin/__tests__/DisplayTab.test.tsx` expecting **PASS**.
- [ ] Commit: `feat(web): theme builder, theme list, per-event theme selection`.

---

## Task 10 — Global settings page

**Files:**
- `web/src/admin/SettingsPage.tsx` (new — replaces stub)
- `web/src/admin/__tests__/SettingsPage.test.tsx` (new)

- [ ] Write FAILING test `web/src/admin/__tests__/SettingsPage.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { screen, waitFor } from '@testing-library/react';
  import { fireEvent } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { SettingsPage } from '../SettingsPage';
  import { renderWithProviders } from './helpers/renderWithProviders';
  import { DEFAULT_MEDIA_LIMITS } from '@rtpa/shared';

  vi.mock('../api', () => {
    const ApiError = class extends Error { status: number; constructor(s: number, m: string){ super(m); this.status = s; } };
    return {
      ApiError,
      adminApi: { getSettings: vi.fn(), saveSettings: vi.fn(), changePassword: vi.fn() },
    };
  });
  import { adminApi, ApiError } from '../api';

  describe('SettingsPage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      (adminApi.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        publicBaseUrl: 'https://party.test', mediaLimits: DEFAULT_MEDIA_LIMITS,
      });
      (adminApi.saveSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        publicBaseUrl: 'https://new.test', mediaLimits: DEFAULT_MEDIA_LIMITS,
      });
      (adminApi.changePassword as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    it('save settings PUTs updated publicBaseUrl and limits', async () => {
      renderWithProviders(<SettingsPage />);
      const base = await screen.findByLabelText(/public base url/i);
      fireEvent.change(base, { target: { value: 'https://new.test' } });
      fireEvent.change(screen.getByLabelText(/photo max bytes/i), { target: { value: '1000' } });
      await userEvent.click(screen.getByRole('button', { name: /save settings/i }));
      await waitFor(() => expect(adminApi.saveSettings).toHaveBeenCalled());
      const arg = (adminApi.saveSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(arg.publicBaseUrl).toBe('https://new.test');
      expect(arg.mediaLimits.photoMaxBytes).toBe(1000);
    });

    it('password mismatch blocks submit and shows message', async () => {
      renderWithProviders(<SettingsPage />);
      await screen.findByLabelText(/public base url/i);
      fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'old' } });
      fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'a' } });
      fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'b' } });
      await userEvent.click(screen.getByRole('button', { name: /change password/i }));
      expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
      expect(adminApi.changePassword).not.toHaveBeenCalled();
    });

    it('wrong current password shows 401 error', async () => {
      (adminApi.changePassword as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, 'bad'));
      renderWithProviders(<SettingsPage />);
      await screen.findByLabelText(/public base url/i);
      fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'old' } });
      fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'abc' } });
      fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'abc' } });
      await userEvent.click(screen.getByRole('button', { name: /change password/i }));
      expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
    });
  });
  ```
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/SettingsPage.test.tsx` and expect **FAIL**.
- [ ] COMPLETE `web/src/admin/SettingsPage.tsx`:
  ```tsx
  import { FormEvent, useEffect, useState } from 'react';
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
  import { adminApi, ApiError } from './api';
  import type { MediaLimits } from '@rtpa/shared';

  export function SettingsPage() {
    const qc = useQueryClient();
    const { data } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => adminApi.getSettings() });

    const [publicBaseUrl, setPublicBaseUrl] = useState('');
    const [limits, setLimits] = useState<MediaLimits>({ photoMaxBytes: 0, videoMaxBytes: 0, videoMaxDurationSec: 0 });
    useEffect(() => {
      if (data) { setPublicBaseUrl(data.publicBaseUrl); setLimits(data.mediaLimits); }
    }, [data]);

    const saveMut = useMutation({
      mutationFn: () => adminApi.saveSettings({ publicBaseUrl, mediaLimits: limits }),
      onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); },
    });

    // password form
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [pwError, setPwError] = useState<string | null>(null);
    const [pwOk, setPwOk] = useState(false);

    async function onChangePassword(e: FormEvent) {
      e.preventDefault();
      setPwError(null); setPwOk(false);
      if (next !== confirm) { setPwError('Passwords do not match.'); return; }
      try {
        await adminApi.changePassword(current, next);
        setPwOk(true); setCurrent(''); setNext(''); setConfirm('');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setPwError('Current password is incorrect.');
        else setPwError('Could not change password.');
      }
    }

    return (
      <section className="settings-page">
        <h1>Settings</h1>

        <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} aria-label="Global settings">
          <label>Public base URL
            <input value={publicBaseUrl} onChange={(e) => setPublicBaseUrl(e.target.value)} />
          </label>
          <label>Photo max bytes
            <input type="number" value={limits.photoMaxBytes} onChange={(e) => setLimits({ ...limits, photoMaxBytes: Number(e.target.value) })} />
          </label>
          <label>Video max bytes
            <input type="number" value={limits.videoMaxBytes} onChange={(e) => setLimits({ ...limits, videoMaxBytes: Number(e.target.value) })} />
          </label>
          <label>Video max duration (sec)
            <input type="number" value={limits.videoMaxDurationSec} onChange={(e) => setLimits({ ...limits, videoMaxDurationSec: Number(e.target.value) })} />
          </label>
          <button type="submit" disabled={saveMut.isPending}>Save settings</button>
        </form>

        <form onSubmit={onChangePassword} aria-label="Change password">
          <h2>Change password</h2>
          <label>Current password
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label>New password
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label>Confirm new password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {pwError && <p role="alert">{pwError}</p>}
          {pwOk && <p role="status">Password changed.</p>}
          <button type="submit">Change password</button>
        </form>
      </section>
    );
  }
  ```
  Note: the test's `getByLabelText(/^new password/i)` requires the "New password" label to not also match "Confirm new password". The regex `^new password` anchors to start, so "Confirm new password" is excluded — labels above are worded accordingly.
- [ ] Run `npm test -w @rtpa/web -- src/admin/__tests__/SettingsPage.test.tsx` and expect **PASS**.
- [ ] Run the full web suite `npm test -w @rtpa/web` and expect **all admin tests PASS**.
- [ ] Commit: `feat(web): global settings and change-password page`.

---

## Plan 5 self-check

Mapping spec §9/§10/§11 items to the tasks that cover them:

**§9 Admin canvas controls (per event, live-applied)** — all in Task 8 (`DisplayTab`), each writing the full `MotionConfig` via debounced `PUT /motion`:
- Motion-style mix (drift/current/orbit/mosaic weight sliders) — Task 8.
- Overall motion speed slider — Task 8.
- Max-on-canvas (hard cap, number input) — Task 8.
- Dwell timeout on/off + duration + variance — Task 8.
- Enter-animation frequency weights (5 sliders) — Task 8.
- Leave-animation frequency weights (4 sliders) — Task 8.
- Base photo size slider — Task 8.
- Size variance slider — Task 8.
- "Open display" launches `/e/:code/display` — Task 8.

**§10 Theming system** — Task 9 (`ThemesPage` + `ThemeEditor`) + `ThemeSelect`:
- List presets + custom — Task 9.
- Edit every token: background type/value, ambient, frame style/borderColor/borderWidth/radius/shadow, caption enabled/bg/color, font, accent — Task 9 `ThemeEditor`.
- Live preview pane (reuses `themeCss` + sample tiles) — Task 9.
- Save custom (PUT), Duplicate preset → custom (POST), presets read-only / Delete disabled, Delete custom — Task 9.
- Theme selected per event (`PUT :id/theme`) — Task 9 `ThemeSelect`, surfaced on DisplayTab.

**§11 Admin console**:
- Events list with status badge / photo count / created date — Task 4.
- Create event (name → POST → navigate to detail) — Task 4.
- Per-event QR (image), shareable upload link, copy/print, pause/resume uploads, end event — Task 6 (`ShareTab`).
- Album manager: grid newest-first, live WebSocket updates (`photo:added/hidden/deleted`), thumbnail + uploader name + timestamp + private device info popover, hide/unhide, delete, bulk select hide/delete, filter to hidden — Task 7 (`AlbumTab`).
- Album export — `adminApi.exportUrl(id)` builder provided (Task 1); link surface can be added on ShareTab (URL builder verified by test).
- Display settings + Open display — Task 8.
- Theme builder — Task 9.
- Global settings (`publicBaseUrl`, media limits, change password with 401 handling) — Task 10.

**Cross-cutting**: password gate (Task 2 `AuthContext`/`LoginPage`/`RequireAdmin`), admin shell nav + router wiring (Task 3), reusable fake-socket + provider test helpers (Task 0).
