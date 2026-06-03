import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  Photo,
  MotionConfig,
  Theme,
} from '@rtpa/shared';

export interface RealtimeEmitters {
  emitPhotoAdded(code: string, photo: Photo): void;
  emitPhotoHidden(code: string, id: string): void;
  emitPhotoDeleted(code: string, id: string): void;
  emitSettingsUpdated(code: string, motionConfig: MotionConfig): void;
  emitThemeUpdated(code: string, theme: Theme): void;
}

const room = (code: string) => `event:${code}`;

/** Attach a typed Socket.IO server to the HTTP server and return emit helpers. */
export function initRealtime(httpServer: HttpServer): RealtimeEmitters {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true, credentials: true },
  });

  io.on('connection', (socket) => {
    socket.on('join', (eventCode: string) => {
      socket.join(room(eventCode));
    });
  });

  return {
    emitPhotoAdded(code, photo) {
      io.to(room(code)).emit('photo:added', photo);
    },
    emitPhotoHidden(code, id) {
      io.to(room(code)).emit('photo:hidden', { id });
    },
    emitPhotoDeleted(code, id) {
      io.to(room(code)).emit('photo:deleted', { id });
    },
    emitSettingsUpdated(code, motionConfig) {
      io.to(room(code)).emit('settings:updated', motionConfig);
    },
    emitThemeUpdated(code, theme) {
      io.to(room(code)).emit('theme:updated', theme);
    },
  };
}
