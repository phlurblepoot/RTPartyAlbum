import { randomBytes } from 'node:crypto';
import {
  DEFAULT_MEDIA_LIMITS,
  SETTINGS_KEYS,
  DEFAULT_THEME_ID,
  type MediaLimits,
} from '@rtpa/shared';
import { PRESET_THEMES } from './presets.js';
import type { ThemeRepo } from './repositories/themeRepo.js';
import type { SettingsRepo } from './repositories/settingsRepo.js';

export interface SeedDeps {
  themeRepo: ThemeRepo;
  settingsRepo: SettingsRepo;
  /** Operator-provided session secret (from SESSION_SECRET env var). When absent or
   *  empty a secure random secret is generated. Ignored if a secret is already stored. */
  sessionSecret?: string;
}

/** Seed preset themes and default settings. Safe to run on every boot (idempotent). */
export function seed(deps: SeedDeps): void {
  const { themeRepo, settingsRepo, sessionSecret } = deps;

  for (const theme of PRESET_THEMES) {
    themeRepo.upsertPreset(theme);
  }

  if (settingsRepo.get(SETTINGS_KEYS.mediaLimits) === undefined) {
    settingsRepo.setJson(SETTINGS_KEYS.mediaLimits, DEFAULT_MEDIA_LIMITS satisfies MediaLimits);
  }

  if (settingsRepo.get(SETTINGS_KEYS.publicBaseUrl) === undefined) {
    settingsRepo.set(SETTINGS_KEYS.publicBaseUrl, '');
  }

  if (settingsRepo.get(SETTINGS_KEYS.sessionSecret) === undefined) {
    const chosen =
      typeof sessionSecret === 'string' && sessionSecret.length > 0
        ? sessionSecret
        : randomBytes(32).toString('hex');
    settingsRepo.set(SETTINGS_KEYS.sessionSecret, chosen);
  }
}

export { DEFAULT_THEME_ID };
