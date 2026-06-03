import { describe, it, expect } from 'vitest';
import type { ThemeTokens } from '@rtpa/shared';
import { openMemoryDb } from '../../connection.js';
import { migrate } from '../../migrate.js';
import { makeThemeRepo } from '../themeRepo.js';

const tokens: ThemeTokens = {
  background: { type: 'solid', value: '#000000' },
  ambient: 'none',
  frame: { style: 'thin', borderColor: '#fff', borderWidth: 1, radius: 4, shadow: false },
  caption: { enabled: true, bg: '#000', color: '#fff' },
  font: 'Inter',
  accent: '#abc',
};

function repo() {
  const db = openMemoryDb();
  migrate(db);
  return { db, themes: makeThemeRepo(db) };
}

describe('themeRepo', () => {
  it('create makes a non-preset theme with a generated id', () => {
    const { db, themes } = repo();
    const t = themes.create({ name: 'My Theme', tokens });
    expect(t.id).toBeTruthy();
    expect(t.isPreset).toBe(false);
    expect(t.name).toBe('My Theme');
    expect(t.tokens).toEqual(tokens);
    expect(themes.getById(t.id)).toEqual(t);
    db.close();
  });

  it('list returns created themes', () => {
    const { db, themes } = repo();
    themes.create({ name: 'A', tokens });
    themes.create({ name: 'B', tokens });
    expect(themes.list()).toHaveLength(2);
    db.close();
  });

  it('update changes name and/or tokens', () => {
    const { db, themes } = repo();
    const t = themes.create({ name: 'A', tokens });
    const updated = themes.update(t.id, { name: 'A2' });
    expect(updated?.name).toBe('A2');
    expect(updated?.tokens).toEqual(tokens);
    const newTokens: ThemeTokens = { ...tokens, accent: '#999' };
    const updated2 = themes.update(t.id, { tokens: newTokens });
    expect(updated2?.tokens.accent).toBe('#999');
    db.close();
  });

  it('update returns undefined for a missing id', () => {
    const { db, themes } = repo();
    expect(themes.update('missing', { name: 'x' })).toBeUndefined();
    db.close();
  });

  it('upsertPreset is idempotent and overwrites tokens', () => {
    const { db, themes } = repo();
    themes.upsertPreset({ id: 'preset-x', name: 'X', isPreset: true, tokens });
    themes.upsertPreset({ id: 'preset-x', name: 'X', isPreset: true, tokens: { ...tokens, accent: '#111' } });
    const t = themes.getById('preset-x');
    expect(t?.isPreset).toBe(true);
    expect(t?.tokens.accent).toBe('#111');
    expect(themes.list()).toHaveLength(1);
    db.close();
  });

  it('remove deletes a custom theme but refuses a preset', () => {
    const { db, themes } = repo();
    const custom = themes.create({ name: 'C', tokens });
    themes.upsertPreset({ id: 'preset-y', name: 'Y', isPreset: true, tokens });
    expect(themes.remove(custom.id)).toBe(true);
    expect(themes.getById(custom.id)).toBeUndefined();
    expect(themes.remove('preset-y')).toBe(false);
    expect(themes.getById('preset-y')).toBeDefined();
    db.close();
  });
});
