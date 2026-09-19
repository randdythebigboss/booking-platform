import { describe, expect, it } from 'vitest';

import {
  hasErrors,
  validateCredentials,
  validateEmail,
  validatePassword,
} from '@/features/auth/validation';

describe('validateEmail', () => {
  it('accepts an ordinary address', () => {
    expect(validateEmail('alex@example.com')).toBeUndefined();
    expect(validateEmail('  alex@example.com  ')).toBeUndefined();
  });

  it('rejects empty and obviously wrong values', () => {
    expect(validateEmail('')).toMatch(/Enter your email/);
    expect(validateEmail('alex')).toMatch(/does not look like/);
    expect(validateEmail('alex@example')).toMatch(/does not look like/);
    expect(validateEmail('alex @example.com')).toMatch(/does not look like/);
  });
});

describe('validatePassword', () => {
  it('requires a minimum length', () => {
    expect(validatePassword('short')).toMatch(/at least 8/);
    expect(validatePassword('longenough')).toBeUndefined();
  });
});

describe('validateCredentials', () => {
  it('reports both fields at once', () => {
    const errors = validateCredentials('nope', 'x');
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
    expect(hasErrors(errors)).toBe(true);
  });

  it('is empty when both are fine', () => {
    const errors = validateCredentials('alex@example.com', 'longenough');
    expect(errors).toEqual({});
    expect(hasErrors(errors)).toBe(false);
  });
});
