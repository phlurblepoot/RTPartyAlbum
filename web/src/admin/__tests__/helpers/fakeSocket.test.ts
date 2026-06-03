import { describe, it, expect, vi } from 'vitest';
import { createFakeSocket } from './fakeSocket';
import type { Photo } from '@rtpa/shared';

const photo: Photo = {
  id: 'p1', eventId: 'e1', uploaderName: 'Sam', mediaType: 'image',
  width: 800, height: 600, durationMs: null, createdAt: '2026-06-02T10:00:00.000Z',
  isHidden: false, isPriority: false, displayUrl: '/media/display/p1.jpg', thumbUrl: '/media/thumb/p1.jpg',
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
