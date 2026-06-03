import { describe, it, expect } from 'vitest';
import { DEFAULT_MOTION_CONFIG, DEFAULT_THEME_ID } from '@rtpa/shared';
import { openMemoryDb } from '../../connection.js';
import { migrate } from '../../migrate.js';
import { makeThemeRepo } from '../themeRepo.js';
import { makeEventRepo } from '../eventRepo.js';
import { makePhotoRepo } from '../photoRepo.js';
import { PRESET_THEMES } from '../../presets.js';

function setup() {
  const db = openMemoryDb();
  migrate(db);
  const themes = makeThemeRepo(db);
  for (const t of PRESET_THEMES) themes.upsertPreset(t);
  const events = makeEventRepo(db);
  const photos = makePhotoRepo(db);
  const ev = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
  return { db, photos, eventId: ev.id };
}

function baseInput(eventId: string, over: Partial<Parameters<ReturnType<typeof makePhotoRepo>['create']>[0]> = {}) {
  return {
    eventId,
    uploaderName: 'Guest',
    filePath: `${eventId}/orig.jpg`,
    displayPath: 'abc123.jpg',
    thumbPath: 'abc123.jpg',
    mediaType: 'image' as const,
    width: 1200,
    height: 800,
    durationMs: null as number | null,
    deviceId: 'dev-1',
    userAgent: 'UA',
    ipAddress: '1.2.3.4',
    ...over,
  };
}

describe('photoRepo', () => {
  it('create returns a PhotoAdmin with mapped fields and derived urls', () => {
    const { db, photos, eventId } = setup();
    const p = photos.create(baseInput(eventId, { displayPath: 'pic.jpg', thumbPath: 'pic.jpg' }));
    expect(p.id).toBeTruthy();
    expect(p.eventId).toBe(eventId);
    expect(p.uploaderName).toBe('Guest');
    expect(p.mediaType).toBe('image');
    expect(p.isHidden).toBe(false);
    expect(p.durationMs).toBeNull();
    expect(p.displayUrl).toBe('/media/display/pic.jpg');
    expect(p.thumbUrl).toBe('/media/thumb/pic.jpg');
    expect(p.deviceId).toBe('dev-1');
    expect(p.userAgent).toBe('UA');
    expect(p.ipAddress).toBe('1.2.3.4');
    db.close();
  });

  it('derives urls from the basename of stored paths', () => {
    const { db, photos, eventId } = setup();
    const p = photos.create(baseInput(eventId, {
      displayPath: '/data/media/display/v1.mp4',
      thumbPath: '/data/media/thumb/v1.jpg',
      mediaType: 'video',
      durationMs: 5000,
    }));
    expect(p.displayUrl).toBe('/media/display/v1.mp4');
    expect(p.thumbUrl).toBe('/media/thumb/v1.jpg');
    expect(p.durationMs).toBe(5000);
    db.close();
  });

  it('listForEventAdmin returns newest-first', () => {
    const { db, photos, eventId } = setup();
    const a = photos.create(baseInput(eventId, { uploaderName: 'first' }));
    const b = photos.create(baseInput(eventId, { uploaderName: 'second' }));
    // force deterministic ordering by created_at
    db.prepare('UPDATE photos SET created_at = ? WHERE id = ?').run('2026-06-02T00:00:01.000Z', a.id);
    db.prepare('UPDATE photos SET created_at = ? WHERE id = ?').run('2026-06-02T00:00:02.000Z', b.id);
    const list = photos.listForEventAdmin(eventId);
    expect(list.map((p) => p.uploaderName)).toEqual(['second', 'first']);
    db.close();
  });

  it('listForEventPublic excludes hidden and returns Photo (no private fields)', () => {
    const { db, photos, eventId } = setup();
    const visible = photos.create(baseInput(eventId, { uploaderName: 'shown' }));
    const hidden = photos.create(baseInput(eventId, { uploaderName: 'hidden' }));
    photos.setHidden(hidden.id, true);
    const pub = photos.listForEventPublic(eventId);
    expect(pub).toHaveLength(1);
    expect(pub[0]!.uploaderName).toBe('shown');
    expect(pub[0]!.id).toBe(visible.id);
    expect('deviceId' in pub[0]!).toBe(false);
    db.close();
  });

  it('setHidden toggles is_hidden and getById reflects it', () => {
    const { db, photos, eventId } = setup();
    const p = photos.create(baseInput(eventId));
    photos.setHidden(p.id, true);
    expect(photos.getById(p.id)?.isHidden).toBe(true);
    photos.setHidden(p.id, false);
    expect(photos.getById(p.id)?.isHidden).toBe(false);
    db.close();
  });

  it('remove deletes the row; countForEvent reflects it', () => {
    const { db, photos, eventId } = setup();
    const p = photos.create(baseInput(eventId));
    expect(photos.countForEvent(eventId)).toBe(1);
    photos.remove(p.id);
    expect(photos.getById(p.id)).toBeUndefined();
    expect(photos.countForEvent(eventId)).toBe(0);
    db.close();
  });
});
