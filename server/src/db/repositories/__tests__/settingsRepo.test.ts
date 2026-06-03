import { describe, it, expect } from 'vitest';
import { openMemoryDb } from '../../connection.js';
import { migrate } from '../../migrate.js';
import { makeSettingsRepo } from '../settingsRepo.js';

function repo() {
  const db = openMemoryDb();
  migrate(db);
  return { db, settings: makeSettingsRepo(db) };
}

describe('settingsRepo', () => {
  it('returns undefined for a missing key', () => {
    const { db, settings } = repo();
    expect(settings.get('nope')).toBeUndefined();
    db.close();
  });

  it('sets and gets a string value (upsert overwrites)', () => {
    const { db, settings } = repo();
    settings.set('k', 'v1');
    expect(settings.get('k')).toBe('v1');
    settings.set('k', 'v2');
    expect(settings.get('k')).toBe('v2');
    db.close();
  });

  it('stores and reads JSON round-trip', () => {
    const { db, settings } = repo();
    settings.setJson('cfg', { a: 1, b: ['x', 'y'] });
    expect(settings.getJson<{ a: number; b: string[] }>('cfg')).toEqual({ a: 1, b: ['x', 'y'] });
    db.close();
  });

  it('getJson returns undefined for a missing key', () => {
    const { db, settings } = repo();
    expect(settings.getJson('missing')).toBeUndefined();
    db.close();
  });
});
