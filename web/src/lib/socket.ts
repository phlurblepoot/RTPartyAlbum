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

/**
 * Join an event's room and keep it joined across reconnects.
 *
 * Socket.IO rooms live on the server and are tied to one connection, so after any
 * network blip or server restart the new connection is in NO room and would never
 * receive another broadcast. We re-emit `join` whenever the manager reconnects, then
 * call `onResync` so the caller can refetch whatever it missed while offline.
 *
 * Returns a cleanup that stops listening for reconnects (it does not leave the room;
 * the shared socket is reused across pages).
 */
export function joinEventRoom(
  socket: AppSocket,
  code: string,
  onResync?: () => void,
): () => void {
  // Emitting while still connecting is fine: socket.io buffers it until connected.
  socket.emit('join', code);
  const onReconnect = () => {
    socket.emit('join', code);
    onResync?.();
  };
  // `io` is the Manager (absent on lightweight test fakes).
  const manager = (socket as Partial<AppSocket>).io;
  manager?.on('reconnect', onReconnect);
  return () => {
    manager?.off('reconnect', onReconnect);
  };
}

/** Test/HMR helper — drops the singleton so the next call reconnects fresh. */
export function resetSocket(): void {
  socket?.close();
  socket = null;
}
