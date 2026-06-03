import type { Db } from '../connection.js';

export const id = '001_init';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE themes (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      is_preset INTEGER NOT NULL DEFAULT 0,
      tokens    TEXT NOT NULL
    );

    CREATE TABLE events (
      id             TEXT PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      name           TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      is_active      INTEGER NOT NULL DEFAULT 0,
      upload_enabled INTEGER NOT NULL DEFAULT 1,
      status         TEXT NOT NULL DEFAULT 'active',
      theme_id       TEXT NOT NULL,
      motion_config  TEXT NOT NULL,
      FOREIGN KEY (theme_id) REFERENCES themes(id)
    );

    CREATE TABLE photos (
      id           TEXT PRIMARY KEY,
      event_id     TEXT NOT NULL,
      uploader_name TEXT NOT NULL,
      file_path    TEXT NOT NULL,
      display_path TEXT NOT NULL,
      thumb_path   TEXT NOT NULL,
      media_type   TEXT NOT NULL,
      width        INTEGER NOT NULL,
      height       INTEGER NOT NULL,
      duration_ms  INTEGER,
      created_at   TEXT NOT NULL,
      is_hidden    INTEGER NOT NULL DEFAULT 0,
      device_id    TEXT NOT NULL,
      user_agent   TEXT NOT NULL,
      ip_address   TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events(id)
    );

    CREATE INDEX idx_photos_event_created ON photos(event_id, created_at DESC);
  `);
}
