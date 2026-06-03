import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

const ENV_KEYS = [
  'PORT', 'DATA_DIR', 'UPLOADS_DIR', 'ADMIN_PASSWORD',
  'PUBLIC_BASE_URL', 'SESSION_SECRET', 'NODE_ENV',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('loadConfig', () => {
  it('uses development defaults when NODE_ENV is unset', () => {
    const c = loadConfig();
    expect(c.port).toBe(8080);
    expect(c.dataDir).toBe('./.data');
    expect(c.uploadsDir).toBe('./.uploads');
    expect(c.publicBaseUrl).toBe('');
    expect(c.sessionSecret).toBe('');
    expect(c.adminPassword).toBeUndefined();
    expect(c.nodeEnv).toBe('development');
  });

  it('uses production volume paths when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    const c = loadConfig();
    expect(c.dataDir).toBe('/data');
    expect(c.uploadsDir).toBe('/uploads');
    expect(c.nodeEnv).toBe('production');
  });

  it('reads values from environment variables', () => {
    process.env.PORT = '9000';
    process.env.DATA_DIR = '/custom/data';
    process.env.UPLOADS_DIR = '/custom/uploads';
    process.env.ADMIN_PASSWORD = 'hunter2';
    process.env.PUBLIC_BASE_URL = 'https://party.example.com';
    process.env.SESSION_SECRET = 's3cret';
    const c = loadConfig();
    expect(c.port).toBe(9000);
    expect(c.dataDir).toBe('/custom/data');
    expect(c.uploadsDir).toBe('/custom/uploads');
    expect(c.adminPassword).toBe('hunter2');
    expect(c.publicBaseUrl).toBe('https://party.example.com');
    expect(c.sessionSecret).toBe('s3cret');
  });

  it('applies overrides on top of env', () => {
    process.env.PORT = '9000';
    const c = loadConfig({ port: 1234, dataDir: '/override' });
    expect(c.port).toBe(1234);
    expect(c.dataDir).toBe('/override');
  });

  it('throws on an invalid PORT', () => {
    process.env.PORT = 'not-a-number';
    expect(() => loadConfig()).toThrow(/Invalid PORT/);
  });

  it('nodeEnv override changes dir defaults', () => {
    const c = loadConfig({ nodeEnv: 'production' });
    expect(c.dataDir).toBe('/data');
    expect(c.uploadsDir).toBe('/uploads');
  });
});
