import type { Db } from '../connection.js';

export const id = '002_priority';

/**
 * Add a host-controlled "priority" (favorite) flag to photos. Priority photos
 * are admitted to the live canvas more often and evicted last. Defaults to 0
 * so all existing photos are non-priority.
 */
export function up(db: Db): void {
  db.exec(`ALTER TABLE photos ADD COLUMN is_priority INTEGER NOT NULL DEFAULT 0;`);
  db.exec(`CREATE INDEX idx_photos_event_priority ON photos(event_id, is_priority);`);
}
