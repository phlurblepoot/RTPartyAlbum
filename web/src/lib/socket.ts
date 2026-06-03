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
