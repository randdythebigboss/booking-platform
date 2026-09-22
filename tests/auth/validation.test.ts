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
    expect(validateEmail('')?.code).toBe('email.required');
    expect(validateEmail('alex')?.code).toBe('email.invalid');
    expect(validateEmail('alex@example')?.code).toBe('email.invalid');
    expect(validateEmail('alex @example.com')?.code).toBe('email.invalid');
  });
});

describe('validatePassword', () => {
  it('requires a minimum length', () => {
    const issue = validatePassword('short');
    expect(issue?.code).toBe('password.tooShort');
    // The constant travels with the issue rather than being written into a
    // sentence, so both languages read the same number and only one place
    // knows what it is.
    expect(issue?.values).toEqual({ min: 8 });
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
