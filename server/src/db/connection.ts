import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

function applyPragmas(db: Db): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

/** Open (creating parent dirs as needed) a persistent SQLite db with WAL + FKs. */
export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  applyPragmas(db);
  return db;
}

/** Open an ephemeral in-memory SQLite db (tests). FKs on; WAL is a no-op for :memory:. */
export function openMemoryDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}
