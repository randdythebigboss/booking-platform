import { describe, expect, it } from 'vitest';

import {
  hasErrors,
  isDemoRegistrationAllowed,
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

describe('isDemoRegistrationAllowed', () => {
  it('accepts the reserved domains, which cannot belong to anybody', () => {
    expect(isDemoRegistrationAllowed('alguien@example.test')).toBe(true);
    expect(isDemoRegistrationAllowed('demo@bookingplatform.test')).toBe(true);
    expect(isDemoRegistrationAllowed('a@b.invalid')).toBe(true);
    expect(isDemoRegistrationAllowed('a@localhost')).toBe(true);
  });

  it('refuses an address that could be somebody else, which is the point', () => {
    expect(isDemoRegistrationAllowed('owner@a-real-salon.com')).toBe(false);
    expect(isDemoRegistrationAllowed('someone@gmail.com')).toBe(false);
    // A lookalike domain must not slip through on a substring.
    expect(isDemoRegistrationAllowed('a@test.com')).toBe(false);
    expect(isDemoRegistrationAllowed('a@nottest')).toBe(false);
  });

  it('is not fooled by case or whitespace', () => {
    expect(isDemoRegistrationAllowed('  Alguien@Example.TEST ')).toBe(true);
    expect(isDemoRegistrationAllowed(' owner@Real.COM ')).toBe(false);
  });

  it('refuses anything that is not an address at all', () => {
    expect(isDemoRegistrationAllowed('')).toBe(false);
    expect(isDemoRegistrationAllowed('no-at-sign')).toBe(false);
  });
});
