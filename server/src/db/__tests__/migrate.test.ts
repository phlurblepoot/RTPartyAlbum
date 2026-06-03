import { describe, it, expect } from 'vitest';
import { openMemoryDb } from '../connection.js';
import { migrate } from '../migrate.js';

function tableNames(db: ReturnType<typeof openMemoryDb>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
    .map((r) => r.name)
    .sort();
}

function indexNames(db: ReturnType<typeof openMemoryDb>): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((r) => r.name)
    .sort();
}

describe('migrate', () => {
  it('creates all tables and the photos index', () => {
    const db = openMemoryDb();
    migrate(db);
    const tables = tableNames(db);
    expect(tables).toContain('settings');
    expect(tables).toContain('themes');
    expect(tables).toContain('events');
    expect(tables).toContain('photos');
    expect(tables).toContain('migrations');
    expect(indexNames(db)).toContain('idx_photos_event_created');
    db.close();
  });

  it('is idempotent — running twice records each migration exactly once', () => {
    const db = openMemoryDb();
    migrate(db);
    migrate(db);
    const applied = db.prepare('SELECT id FROM migrations ORDER BY id').all() as { id: string }[];
    expect(applied.map((r) => r.id)).toEqual(['001_init', '002_priority']);
    // tables still intact
    expect(tableNames(db)).toContain('photos');
    db.close();
  });

  it('adds the photos.is_priority column (migration 002)', () => {
    const db = openMemoryDb();
    migrate(db);
    const cols = (db.prepare('PRAGMA table_info(photos)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('is_priority');
    expect(indexNames(db)).toContain('idx_photos_event_priority');
    db.close();
  });

  it('enforces the theme_id foreign key on events', () => {
    const db = openMemoryDb();
    migrate(db);
    const insert = () =>
      db.prepare(
        `INSERT INTO events (id, code, name, created_at, theme_id, motion_config)
         VALUES ('e1', 'abc', 'Party', '2026-06-02T00:00:00.000Z', 'missing-theme', '{}')`,
      ).run();
    expect(insert).toThrow();
    db.close();
  });
});
