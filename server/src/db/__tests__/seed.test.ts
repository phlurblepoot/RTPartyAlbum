import { describe, it, expect } from 'vitest';
import { DEFAULT_THEME_ID, SETTINGS_KEYS, type MediaLimits } from '@rtpa/shared';
import { openMemoryDb } from '../connection.js';
import { migrate } from '../migrate.js';
import { makeThemeRepo } from '../repositories/themeRepo.js';
import { makeSettingsRepo } from '../repositories/settingsRepo.js';
import { seed } from '../seed.js';
import { PRESET_THEMES } from '../presets.js';

function freshSeededDb() {
  const db = openMemoryDb();
  migrate(db);
  const themeRepo = makeThemeRepo(db);
  const settingsRepo = makeSettingsRepo(db);
  return { db, themeRepo, settingsRepo };
}

describe('seed', () => {
  it('inserts all 9 presets including the default theme', () => {
    const { db, themeRepo, settingsRepo } = freshSeededDb();
    seed({ themeRepo, settingsRepo });
    const themes = themeRepo.list();
    expect(themes).toHaveLength(9);
    expect(themeRepo.getById(DEFAULT_THEME_ID)).toBeDefined();
    for (const p of PRESET_THEMES) {
      expect(themeRepo.getById(p.id)?.isPreset).toBe(true);
    }
    db.close();
  });

  it('seeds default media limits and an empty public base url', () => {
    const { db, themeRepo, settingsRepo } = freshSeededDb();
    seed({ themeRepo, settingsRepo });
    const limits = settingsRepo.getJson<MediaLimits>(SETTINGS_KEYS.mediaLimits);
    expect(limits?.photoMaxBytes).toBe(25 * 1024 * 1024);
    expect(settingsRepo.get(SETTINGS_KEYS.publicBaseUrl)).toBe('');
    db.close();
  });

  it('generates and stores a session secret when absent', () => {
    const { db, themeRepo, settingsRepo } = freshSeededDb();
    seed({ themeRepo, settingsRepo });
    const secret = settingsRepo.get(SETTINGS_KEYS.sessionSecret);
    expect(typeof secret).toBe('string');
    expect((secret ?? '').length).toBeGreaterThanOrEqual(32);
    db.close();
  });

  it('is idempotent and does not regenerate the session secret', () => {
    const { db, themeRepo, settingsRepo } = freshSeededDb();
    seed({ themeRepo, settingsRepo });
    const firstSecret = settingsRepo.get(SETTINGS_KEYS.sessionSecret);
    seed({ themeRepo, settingsRepo });
    seed({ themeRepo, settingsRepo });
    expect(themeRepo.list()).toHaveLength(9);
    expect(settingsRepo.get(SETTINGS_KEYS.sessionSecret)).toBe(firstSecret);
    db.close();
  });
});
