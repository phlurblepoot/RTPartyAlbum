import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisplayPage } from '../DisplayPage';
import { makePhoto, testConfig } from '../../display/__tests__/fixtures';
import { PRESET_THEME_TOKENS } from '../../display/renderer/__tests__/testTheme';
import * as rotationEngine from '../../display/rotationEngine';
import type { PublicEvent, Photo, Theme } from '@rtpa/shared';

// --- fakes ---
const fakeSocket = {
  handlers: {} as Record<string, (...args: any[]) => void>,
  emit: vi.fn(),
  on(ev: string, cb: (...args: any[]) => void) {
    this.handlers[ev] = cb;
  },
  off: vi.fn(),
  disconnect: vi.fn(),
};
vi.mock('../../lib/socket', () => ({
  getSocket: () => fakeSocket,
  connectSocket: () => fakeSocket,
}));

// Stub framer-motion so AnimatePresence does not retain exiting tiles in the
// DOM (its real exit animations never settle under jsdom + fake timers). This
// lets the tests assert engine-driven add/evict/remove against the live tile
// set. CanvasRenderer's real animation behavior is covered by its own suite.
vi.mock('framer-motion', () => {
  const React = require('react');
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) => {
      const { initial, animate, exit, transition, ...rest } = props;
      return React.createElement(tag, { ...rest, ref });
    });
  return {
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }),
  };
});

const publicEvent: PublicEvent = {
  code: 'ABC',
  name: 'Party',
  status: 'active',
  uploadEnabled: true,
  theme: { id: 't1', name: 'T', isPreset: true, tokens: PRESET_THEME_TOKENS },
  motionConfig: { ...testConfig, maxOnCanvas: 3 },
};
let albumPhotos: Photo[] = [];
vi.mock('../../api/client', () => ({
  getPublicEvent: vi.fn(async () => publicEvent),
  getPublicPhotos: vi.fn(async () => albumPhotos),
}));

function renderPage(rng = () => 0.5) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/e/ABC/display']}>
        <Routes>
          <Route path="/e/:code/display" element={<DisplayPage rng={rng} tickMs={1000} now={() => 0} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // shouldAdvanceTime lets testing-library's waitFor poll under fake timers
  // (so async react-query resolution settles) while vi.advanceTimersByTime
  // still drives the rotation loop's interval explicitly. Matches the repo's
  // existing fake-timer convention (see admin/__tests__/DisplayTab.test.tsx).
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fakeSocket.handlers = {};
  fakeSocket.emit.mockClear();
  albumPhotos = Array.from({ length: 6 }, (_, i) => makePhoto('a' + i));
  // default: motion not reduced
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Renders <DisplayPage /> with NO injected props — the exact production path
// router.tsx uses, where `now`/`rng`/`tickMs` fall back to defaults (fresh
// closures every render).
function renderPageDefaultProps() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/e/ABC/display']}>
        <Routes>
          <Route path="/e/:code/display" element={<DisplayPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DisplayPage', () => {
  it('initial fill does not exceed maxOnCanvas and joins the room', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBeGreaterThan(0));
    expect(container.querySelectorAll('[data-tile-id]').length).toBeLessThanOrEqual(3);
    expect(fakeSocket.emit).toHaveBeenCalledWith('join', 'ABC');
  });

  it('photo:added causes the new upload to be admitted', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBe(3));
    act(() => {
      fakeSocket.handlers['photo:added'](makePhoto('NEW'));
    });
    // advance a couple of ticks + leave grace for displacement
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(container.querySelector('[data-tile-id="NEW"]')).not.toBeNull());
    expect(container.querySelectorAll('[data-tile-id]').length).toBeLessThanOrEqual(3);
  });

  it('settings:updated lowering maxOnCanvas evicts down to the new cap', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBe(3));
    act(() => {
      fakeSocket.handlers['settings:updated']({ ...testConfig, maxOnCanvas: 1 });
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBeLessThanOrEqual(1));
  });

  it('photo:deleted removes the tile', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBe(3));
    const id = (container.querySelector('[data-tile-id]') as HTMLElement).getAttribute('data-tile-id')!;
    act(() => {
      fakeSocket.handlers['photo:deleted']({ id });
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    await waitFor(() => expect(container.querySelector(`[data-tile-id="${id}"]`)).toBeNull());
  });

  it('reduced-motion renders a static path', async () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBeGreaterThan(0));
    expect(container.querySelector('[data-testid="canvas-surface"]')).not.toBeNull();
  });

  it('theme:updated swaps the live theme (Backdrop re-renders with new tokens)', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBeGreaterThan(0));

    const backdrop = () => container.querySelector('[data-testid="backdrop"]') as HTMLElement;
    // Initial theme: gradient background + glow ambient (from PRESET_THEME_TOKENS).
    expect(backdrop().style.background).toContain('linear-gradient');
    expect(container.querySelector('.ambient-glow')).not.toBeNull();

    const newTheme: Theme = {
      id: 't2',
      name: 'Sunset',
      isPreset: false,
      tokens: {
        ...PRESET_THEME_TOKENS,
        background: { type: 'solid', value: 'rgb(255, 0, 0)' },
        ambient: 'bokeh',
      },
    };
    act(() => {
      fakeSocket.handlers['theme:updated'](newTheme);
    });

    await waitFor(() => expect(backdrop().style.background).toBe('rgb(255, 0, 0)'));
    expect(backdrop().style.background).not.toContain('linear-gradient');
    expect(container.querySelector('.ambient-bokeh')).not.toBeNull();
    expect(container.querySelector('.ambient-glow')).toBeNull();
  });

  it('seeds the engine exactly once with default props (no re-seed loop)', async () => {
    // Regression: the seed effect must NOT depend on `now`/`rng`. With default
    // props (the production router.tsx path), those are fresh closures every
    // render; if the effect depended on them it would re-seed unboundedly.
    const seedSpy = vi.spyOn(rotationEngine, 'createEngineState');
    const { container } = renderPageDefaultProps();
    await waitFor(() => expect(container.querySelectorAll('[data-tile-id]').length).toBeGreaterThan(0));
    // Let any stray render-triggered re-seeds accumulate before asserting.
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(seedSpy).toHaveBeenCalledTimes(1);
  });
});
