import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { io as ioClient, type Socket } from 'socket.io-client';
import { initRealtime } from '../realtime.js';
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

/** Resolve when `socket` receives `event`, reject if it doesn't within `ms`. */
function waitFor<T>(socket: Socket, event: string, ms = 1000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      ms,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    await sleep(50); // let server-side room joins register

    // Positive path is event-driven (resolves on receipt, not timer-gated).
    const received = waitFor<typeof DEFAULT_MOTION_CONFIG>(inRoom, 'settings:updated');
    let otherGot = false;
    otherRoom.on('settings:updated', () => {
      otherGot = true;
    });

    rt.emitSettingsUpdated('abc123', DEFAULT_MOTION_CONFIG);

    const cfg = await received;
    expect(cfg).toEqual(DEFAULT_MOTION_CONFIG);

    // Room-isolation: evaluated only AFTER the positive receipt resolves plus a
    // short grace, so a stray cross-room delivery has had time to arrive.
    await sleep(50);
    expect(otherGot).toBe(false);
  });
});
