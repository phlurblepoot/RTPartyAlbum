import type { Db } from './connection.js';
import * as init001 from './migrations/001_init.js';

interface Migration {
  id: string;
  up: (db: Db) => void;
}

const MIGRATIONS: Migration[] = [
  { id: init001.id, up: init001.up },
];

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

/** Apply all not-yet-applied migrations. Safe to call repeatedly (idempotent). */
export function migrate(db: Db): void {
  ensureMigrationsTable(db);
  const appliedRows = db.prepare('SELECT id FROM migrations').all() as { id: string }[];
  const applied = new Set(appliedRows.map((r) => r.id));
  const record = db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)');

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const run = db.transaction(() => {
      m.up(db);
      record.run(m.id, new Date().toISOString());
    });
    run();
  }
}
