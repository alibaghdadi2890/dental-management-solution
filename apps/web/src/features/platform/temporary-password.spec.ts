import { passwordSchema } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword } from './temporary-password';

describe('generateTemporaryPassword', () => {
  it('produces hyphenated groups that satisfy the password policy', () => {
    for (let i = 0; i < 50; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
      expect(passwordSchema.safeParse(password).success).toBe(true);
    }
  });

  it('never uses look-alike characters', () => {
    const sample = Array.from({ length: 200 }, () => generateTemporaryPassword()).join('');
    expect(sample).not.toMatch(/[0O1lI]/);
  });

  it('rejects biased bytes instead of wrapping them', () => {
    const bytes = [255, 254, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const random = (buffer: Uint8Array) => {
      buffer[0] = bytes.shift() ?? 0;
      return buffer;
    };
    expect(generateTemporaryPassword(random)).toBe('ABCD-EFGH-JKLM');
  });
});
