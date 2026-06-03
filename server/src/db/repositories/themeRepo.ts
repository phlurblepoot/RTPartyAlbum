import { nanoid } from 'nanoid';
import type { Theme, ThemeTokens } from '@rtpa/shared';
import type { Db } from '../connection.js';

export interface ThemeRepo {
  list(): Theme[];
  getById(id: string): Theme | undefined;
  create(input: { name: string; tokens: ThemeTokens }): Theme;
  update(id: string, input: { name?: string; tokens?: ThemeTokens }): Theme | undefined;
  remove(id: string): boolean;
  upsertPreset(theme: Theme): void;
}

interface ThemeRow {
  id: string;
  name: string;
  is_preset: number;
  tokens: string;
}

function rowToTheme(row: ThemeRow): Theme {
  return {
    id: row.id,
    name: row.name,
    isPreset: row.is_preset === 1,
    tokens: JSON.parse(row.tokens) as ThemeTokens,
  };
}

export function makeThemeRepo(db: Db): ThemeRepo {
  const selById = db.prepare('SELECT id, name, is_preset, tokens FROM themes WHERE id = ?');
  const selAll = db.prepare('SELECT id, name, is_preset, tokens FROM themes ORDER BY is_preset DESC, name ASC');
  const insert = db.prepare('INSERT INTO themes (id, name, is_preset, tokens) VALUES (?, ?, ?, ?)');
  const upsert = db.prepare(
    `INSERT INTO themes (id, name, is_preset, tokens) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_preset = excluded.is_preset, tokens = excluded.tokens`,
  );
  const updName = db.prepare('UPDATE themes SET name = ? WHERE id = ?');
  const updTokens = db.prepare('UPDATE themes SET tokens = ? WHERE id = ?');
  const del = db.prepare('DELETE FROM themes WHERE id = ?');

  function getById(id: string): Theme | undefined {
    const row = selById.get(id) as ThemeRow | undefined;
    return row ? rowToTheme(row) : undefined;
  }

  function list(): Theme[] {
    return (selAll.all() as ThemeRow[]).map(rowToTheme);
  }

  function create(input: { name: string; tokens: ThemeTokens }): Theme {
    const id = nanoid();
    insert.run(id, input.name, 0, JSON.stringify(input.tokens));
    return { id, name: input.name, isPreset: false, tokens: input.tokens };
  }

  function update(id: string, input: { name?: string; tokens?: ThemeTokens }): Theme | undefined {
    const existing = getById(id);
    if (!existing) return undefined;
    if (input.name !== undefined) updName.run(input.name, id);
    if (input.tokens !== undefined) updTokens.run(JSON.stringify(input.tokens), id);
    return getById(id);
  }

  function remove(id: string): boolean {
    const existing = getById(id);
    if (!existing || existing.isPreset) return false;
    del.run(id);
    return true;
  }

  function upsertPreset(theme: Theme): void {
    upsert.run(theme.id, theme.name, theme.isPreset ? 1 : 0, JSON.stringify(theme.tokens));
  }

  return { list, getById, create, update, remove, upsertPreset };
}
