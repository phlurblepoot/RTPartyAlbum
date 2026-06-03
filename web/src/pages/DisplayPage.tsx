import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { MotionConfig, Photo, Theme } from '@rtpa/shared';
import { getPublicEvent, getPublicPhotos } from '../api/client';
import { connectSocket } from '../lib/socket';
import {
  createEngineState,
  enqueueUpload,
  removePhoto,
  tick,
  type EngineState,
  type Rng,
} from '../display/rotationEngine';
import { CanvasRenderer } from '../display/renderer/CanvasRenderer';
import { Backdrop } from '../display/Backdrop';

interface DisplayPageProps {
  /** Injectable RNG for deterministic tests. Default: Math.random. */
  rng?: Rng;
  /** Animation-loop cadence in ms. Default: 1000. */
  tickMs?: number;
  /** Monotonic clock source. Default: () => performance.now(). */
  now?: () => number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function DisplayPage({
  rng = Math.random,
  tickMs = 1000,
  now = () => performance.now(),
}: DisplayPageProps = {}) {
  const { code = '' } = useParams();
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  const eventQuery = useQuery({
    queryKey: ['public-event', code],
    queryFn: () => getPublicEvent(code),
    enabled: !!code,
  });
  const photosQuery = useQuery({
    queryKey: ['public-photos', code],
    queryFn: () => getPublicPhotos(code),
    enabled: !!code,
  });

  const [state, setState] = useState<EngineState | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);

  // Keep a live ref to the latest engine state so the interval callback never
  // operates on a stale closure (it reads stateRef.current, not a captured value).
  const stateRef = useRef<EngineState | null>(null);
  stateRef.current = state;

  // Loop params held in refs so the interval effect can depend only on
  // `engineReady` and never tear down/recreate the interval when these props
  // (often fresh inline closures from a parent) change identity each render.
  const rngRef = useRef(rng);
  rngRef.current = rng;
  const nowRef = useRef(now);
  nowRef.current = now;
  const tickMsRef = useRef(tickMs);
  tickMsRef.current = tickMs;

  // Virtual engine clock. Seeded from `now()` at first tick and advanced by
  // `tickMs` every loop iteration. Driving the engine off a monotonic
  // accumulator (rather than calling `now()` each tick) keeps grace-based
  // tile removal advancing even when `now` is a frozen stub in tests, and
  // matches real wall-clock cadence in production.
  const clockRef = useRef(0);

  // Seed the engine once both queries resolve. A single tick fills onCanvas up
  // to maxOnCanvas (admission loops until the cap, draining queue then album).
  // Depend ONLY on the query data — `now`/`rng` are read from refs so default
  // props (fresh closures every render in production, since router.tsx renders
  // <DisplayPage /> with no props) cannot retrigger this effect. Otherwise the
  // seed would re-run every render, re-creating the EngineState in an unbounded
  // re-seed/re-render loop.
  useEffect(() => {
    if (!eventQuery.data || !photosQuery.data) return;
    setTheme(eventQuery.data.theme);
    clockRef.current = nowRef.current();
    let s = createEngineState(photosQuery.data, eventQuery.data.motionConfig);
    s = tick(s, clockRef.current, rngRef.current);
    setState(s);
  }, [eventQuery.data, photosQuery.data]);

  // Socket wiring. Handlers use functional setState so they always act on the
  // latest engine state (no stale closure). Cleanup removes only our handlers;
  // the shared singleton socket is intentionally NOT disconnected.
  useEffect(() => {
    if (!code) return;
    const socket = connectSocket();
    socket.emit('join', code);

    const onAdded = (photo: Photo) => setState((s) => (s ? enqueueUpload(s, photo) : s));
    const onHidden = (p: { id: string }) => setState((s) => (s ? removePhoto(s, p.id) : s));
    const onDeleted = (p: { id: string }) => setState((s) => (s ? removePhoto(s, p.id) : s));
    const onSettings = (motionConfig: MotionConfig) =>
      setState((s) => (s ? { ...s, config: motionConfig } : s));
    const onTheme = (t: Theme) => setTheme(t);

    socket.on('photo:added', onAdded);
    socket.on('photo:hidden', onHidden);
    socket.on('photo:deleted', onDeleted);
    socket.on('settings:updated', onSettings);
    socket.on('theme:updated', onTheme);

    return () => {
      socket.off('photo:added', onAdded);
      socket.off('photo:hidden', onHidden);
      socket.off('photo:deleted', onDeleted);
      socket.off('settings:updated', onSettings);
      socket.off('theme:updated', onTheme);
    };
  }, [code]);

  // Animation/rotation loop. Reads the live ref and commits a fresh tick each
  // cadence; cleaned up on unmount / when the engine resets.
  const engineReady = state !== null;
  useEffect(() => {
    if (!engineReady) return;
    const id = setInterval(() => {
      const current = stateRef.current;
      if (!current) return;
      clockRef.current += tickMsRef.current;
      const next = tick(current, clockRef.current, rngRef.current);
      // Advance the ref synchronously so consecutive ticks fired within a
      // single timer flush (before React re-renders) each build on the prior
      // tick's result rather than a stale committed state.
      stateRef.current = next;
      setState(next);
    }, tickMsRef.current);
    return () => clearInterval(id);
  }, [engineReady]);

  if (eventQuery.isError) {
    return (
      <div data-testid="display-error" style={{ color: '#fff' }}>
        Event not found
      </div>
    );
  }
  if (!state || !theme) {
    return (
      <div
        data-testid="display-loading"
        style={{ position: 'fixed', inset: 0, background: '#000' }}
      />
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <Backdrop theme={theme.tokens} />
      <CanvasRenderer
        tiles={state.onCanvas}
        config={state.config}
        theme={theme.tokens}
        reducedMotion={reducedMotion}
      />
    </div>
  );
}

export default DisplayPage;
