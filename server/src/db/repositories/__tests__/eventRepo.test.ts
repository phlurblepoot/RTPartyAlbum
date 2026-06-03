import { describe, it, expect } from 'vitest';
import { DEFAULT_MOTION_CONFIG, DEFAULT_THEME_ID } from '@rtpa/shared';
import { openMemoryDb } from '../../connection.js';
import { migrate } from '../../migrate.js';
import { makeThemeRepo } from '../themeRepo.js';
import { makeEventRepo } from '../eventRepo.js';
import { PRESET_THEMES } from '../../presets.js';

function setup() {
  const db = openMemoryDb();
  migrate(db);
  const themes = makeThemeRepo(db);
  for (const t of PRESET_THEMES) themes.upsertPreset(t);
  const events = makeEventRepo(db);
  return { db, events };
}

describe('eventRepo', () => {
  it('create returns an EventDetail with parsed motionConfig and zero photoCount', () => {
    const { db, events } = setup();
    const e = events.create({
      name: 'Birthday', code: 'bday', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG,
    });
    expect(e.code).toBe('bday');
    expect(e.name).toBe('Birthday');
    expect(e.themeId).toBe(DEFAULT_THEME_ID);
    expect(e.isActive).toBe(false);
    expect(e.uploadEnabled).toBe(true);
    expect(e.status).toBe('active');
    expect(e.photoCount).toBe(0);
    expect(e.motionConfig).toEqual(DEFAULT_MOTION_CONFIG);
    expect(typeof e.createdAt).toBe('string');
    db.close();
  });

  it('getById and getByCode round-trip', () => {
    const { db, events } = setup();
    const e = events.create({ name: 'A', code: 'aaa', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
    expect(events.getById(e.id)?.code).toBe('aaa');
    expect(events.getByCode('aaa')?.id).toBe(e.id);
    expect(events.getById('missing')).toBeUndefined();
    expect(events.getByCode('missing')).toBeUndefined();
    db.close();
  });

  it('codeExists reflects existing codes', () => {
    const { db, events } = setup();
    events.create({ name: 'A', code: 'taken', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
    expect(events.codeExists('taken')).toBe(true);
    expect(events.codeExists('free')).toBe(false);
    db.close();
  });

  it('activate sets the target active and pauses all others', () => {
    const { db, events } = setup();
    const a = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
    const b = events.create({ name: 'B', code: 'b', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
    events.activate(a.id);
    events.activate(b.id);
    expect(events.getById(a.id)?.isActive).toBe(false);
    expect(events.getById(a.id)?.status).toBe('paused');
    expect(events.getById(b.id)?.isActive).toBe(true);
    expect(events.getById(b.id)?.status).toBe('active');
    db.close();
  });

  it('setUploadEnabled toggles the flag', () => {
    const { db, events } = setup();
    const a = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
    events.setUploadEnabled(a.id, false);
    expect(events.getById(a.id)?.uploadEnabled).toBe(false);
    events.setUploadEnabled(a.id, true);
    expect(events.getById(a.id)?.uploadEnabled).toBe(true);
    db.close();
  });

  it('end marks status ended, inactive, uploads off', () => {
    const { db, events } = setup();
    const a = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
    events.activate(a.id);
    events.end(a.id);
    const after = events.getById(a.id);
    expect(after?.status).toBe('ended');
    expect(after?.isActive).toBe(false);
    expect(after?.uploadEnabled).toBe(false);
    db.close();
  });

  it('setMotionConfig and setTheme persist changes', () => {
    const { db, events } = setup();
    const a = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
    const newCfg = { ...DEFAULT_MOTION_CONFIG, speed: 2, maxOnCanvas: 12 };
    events.setMotionConfig(a.id, newCfg);
    expect(events.getById(a.id)?.motionConfig.speed).toBe(2);
    expect(events.getById(a.id)?.motionConfig.maxOnCanvas).toBe(12);
    const other = PRESET_THEMES[2]!.id;
    events.setTheme(a.id, other);
    expect(events.getById(a.id)?.themeId).toBe(other);
    db.close();
  });

  it('list returns summaries newest-first with photoCount', () => {
    const { db, events } = setup();
    const a = events.create({ name: 'A', code: 'a', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
    const b = events.create({ name: 'B', code: 'b', themeId: DEFAULT_THEME_ID, motionConfig: DEFAULT_MOTION_CONFIG });
    // insert a photo for b directly to assert photoCount join
    db.prepare(
      `INSERT INTO photos (id, event_id, uploader_name, file_path, display_path, thumb_path,
          media_type, width, height, duration_ms, created_at, is_hidden, device_id, user_agent, ip_address)
       VALUES ('p1', ?, 'Guest', 'f', 'd', 't', 'image', 100, 100, NULL, '2026-06-02T00:00:00.000Z', 0, 'dev', 'ua', 'ip')`,
    ).run(b.id);
    const list = events.list();
    expect(list).toHaveLength(2);
    const byId = Object.fromEntries(list.map((e) => [e.id, e]));
    expect(byId[b.id]!.photoCount).toBe(1);
    expect(byId[a.id]!.photoCount).toBe(0);
    // newest-first: b was created after a
    expect(list[0]!.id).toBe(b.id);
    db.close();
  });
});
