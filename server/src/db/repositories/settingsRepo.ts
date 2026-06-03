import type { Db } from '../connection.js';

export interface SettingsRepo {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  getJson<T>(key: string): T | undefined;
  setJson(key: string, value: unknown): void;
}

export function makeSettingsRepo(db: Db): SettingsRepo {
  const selectStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const upsertStmt = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  function get(key: string): string | undefined {
    const row = selectStmt.get(key) as { value: string } | undefined;
    return row?.value;
  }

  function set(key: string, value: string): void {
    upsertStmt.run(key, value);
  }

  function getJson<T>(key: string): T | undefined {
    const raw = get(key);
    if (raw === undefined) return undefined;
    return JSON.parse(raw) as T;
  }

  function setJson(key: string, value: unknown): void {
    set(key, JSON.stringify(value));
  }

  return { get, set, getJson, setJson };
}
