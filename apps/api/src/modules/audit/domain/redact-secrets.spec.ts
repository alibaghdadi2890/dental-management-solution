import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact-secrets';

describe('redactSecrets', () => {
  it('drops secret-looking fields at any depth and keeps everything else', () => {
    expect(
      redactSecrets({
        email: 'a@b.co',
        temporaryPassword: 'x',
        nested: { token: 't', name: 'Main', items: [{ secret: 's', code: 'R1' }] },
      }),
    ).toEqual({ email: 'a@b.co', nested: { name: 'Main', items: [{ code: 'R1' }] } });
  });

  it('passes through primitives and null', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets('text')).toBe('text');
  });
});
