export interface Config {
  port: number;                       // PORT, default 8080
  dataDir: string;                    // DATA_DIR, default '/data' (dev: './.data')
  uploadsDir: string;                 // UPLOADS_DIR, default '/uploads' (dev: './.uploads')
  adminPassword: string | undefined;  // ADMIN_PASSWORD (bootstrap)
  publicBaseUrl: string;              // PUBLIC_BASE_URL, default ''
  sessionSecret: string;              // SESSION_SECRET; '' means "generate & store later"
  nodeEnv: string;                    // NODE_ENV
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid PORT value: "${raw}"`);
  }
  return n;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  const nodeEnv = overrides.nodeEnv ?? env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';

  const base: Config = {
    port: parsePort(env.PORT, 8080),
    dataDir: env.DATA_DIR ?? (isProd ? '/data' : './.data'),
    uploadsDir: env.UPLOADS_DIR ?? (isProd ? '/uploads' : './.uploads'),
    adminPassword: env.ADMIN_PASSWORD,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? '',
    sessionSecret: env.SESSION_SECRET ?? '',
    nodeEnv,
  };

  return { ...base, ...overrides };
}
