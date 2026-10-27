import { resolve } from 'node:path';

export const config = {
  port: Number(process.env.PORT || 4080),
  databasePath: resolve(process.env.DATABASE_PATH || './data/flowforge.db'),
  encryptionKey: process.env.ENCRYPTION_KEY || 'development-only-change-me-32chars',
  sessionHours: Number(process.env.SESSION_HOURS || 24),
  bodyLimit: Number(process.env.BODY_LIMIT_BYTES || 1_048_576),
  requestTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS || 15_000),
  allowPrivateNetwork: process.env.ALLOW_PRIVATE_NETWORK === 'true',
  secureCookies: process.env.SECURE_COOKIES === 'true'
};

if (process.env.NODE_ENV === 'production' && config.encryptionKey === 'development-only-change-me-32chars') {
  throw new Error('ENCRYPTION_KEY must be configured in production.');
}
