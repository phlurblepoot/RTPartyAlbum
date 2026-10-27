import { describe, it, expect, vi } from 'vitest';
import { joinEventRoom, type AppSocket } from './socket';

function fakeSocketWithManager() {
  const managerHandlers: Record<string, () => void> = {};
  const socket = {
    emit: vi.fn(),
    io: {
      on: vi.fn((ev: string, cb: () => void) => {
        managerHandlers[ev] = cb;
      }),
      off: vi.fn((ev: string) => {
        delete managerHandlers[ev];
      }),
    },
  };
  return { socket: socket as unknown as AppSocket, raw: socket, managerHandlers };
}

describe('joinEventRoom', () => {
  it('joins immediately and re-joins + resyncs on every reconnect', () => {
    const { socket, raw, managerHandlers } = fakeSocketWithManager();
    const resync = vi.fn();
    joinEventRoom(socket, 'ABC', resync);
    expect(raw.emit).toHaveBeenCalledWith('join', 'ABC');
    expect(resync).not.toHaveBeenCalled();

    managerHandlers.reconnect();
    managerHandlers.reconnect();
    expect(raw.emit).toHaveBeenCalledTimes(3);
    expect(resync).toHaveBeenCalledTimes(2);
  });

  it('cleanup stops listening for reconnects', () => {
    const { socket, managerHandlers } = fakeSocketWithManager();
    const stop = joinEventRoom(socket, 'ABC');
    stop();
    expect(managerHandlers.reconnect).toBeUndefined();
  });
});
