import { describe, expect, it } from 'vitest';
import { InvalidConfigError, loadConfig } from './config.schema';

const validEnv = {
  DATABASE_URL: 'postgres://dcm_app:secret@localhost:5432/dcm',
  DATABASE_ADMIN_URL: 'postgres://dcm_admin:secret@localhost:5432/dcm',
  REDIS_URL: 'redis://localhost:6379',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'dcm-local',
  S3_ACCESS_KEY_ID: 'minio',
  S3_SECRET_ACCESS_KEY: 'minio-secret',
};

describe('loadConfig', () => {
  it('applies defaults and coerces types', () => {
    const config = loadConfig({ ...validEnv, PORT: '4000', S3_FORCE_PATH_STYLE: 'true' });

    expect(config.PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.DATABASE_POOL_MAX).toBe(10);
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.S3_ENDPOINT).toBeUndefined();
  });

  it('refuses to start without required settings and names every problem', () => {
    const { DATABASE_URL: _db, REDIS_URL: _redis, ...incomplete } = validEnv;

    expect(() => loadConfig(incomplete)).toThrow(InvalidConfigError);
    expect(() => loadConfig(incomplete)).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('rejects malformed values', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...validEnv, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
