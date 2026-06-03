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
