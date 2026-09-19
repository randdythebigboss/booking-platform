import { describe, expect, it } from 'vitest';

import { WorkspaceError, toWorkspaceError } from '@/features/workspace';

describe('toWorkspaceError', () => {
  it('maps the sentinels the Phase 1 functions raise', () => {
    expect(toWorkspaceError({ message: 'SLUG_TAKEN' }).code).toBe('SLUG_TAKEN');
    expect(toWorkspaceError({ message: 'INVALID_TIME_RANGE' }).code).toBe('INVALID_TIME_RANGE');
    expect(toWorkspaceError({ message: 'NOT_ALLOWED' }).code).toBe('NOT_ALLOWED');
  });

  it('names a unique violation on the public link', () => {
    const error = toWorkspaceError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "businesses_slug_key"',
    });
    expect(error.code).toBe('SLUG_TAKEN');
    expect(error.message).toMatch(/already taken/);
  });

  it('recognises the timezone trigger, which raises prose', () => {
    expect(toWorkspaceError({ message: 'Invalid IANA timezone: Mars/Olympus' }).code).toBe(
      'INVALID_TIMEZONE',
    );
  });

  it('maps the Supabase Auth phrases that users actually hit', () => {
    expect(toWorkspaceError({ message: 'Invalid login credentials' }).code).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(toWorkspaceError({ message: 'User already registered' }).code).toBe('EMAIL_TAKEN');
    expect(toWorkspaceError({ message: 'Email not confirmed' }).code).toBe('EMAIL_NOT_CONFIRMED');
    expect(toWorkspaceError({ message: 'Password should be at least 6 characters' }).code).toBe(
      'WEAK_PASSWORD',
    );
  });

  it('never leaks an unrecognised database message', () => {
    const error = toWorkspaceError({
      message: 'relation "public.secret_table" does not exist',
    });
    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toBe('Something went wrong. Please try again.');
  });

  it('handles a failure with no message at all', () => {
    expect(toWorkspaceError(undefined).code).toBe('UNKNOWN');
    expect(toWorkspaceError(null).code).toBe('UNKNOWN');
  });

  it('passes an existing WorkspaceError straight through', () => {
    const original = new WorkspaceError('NOT_ALLOWED');
    expect(toWorkspaceError(original)).toBe(original);
  });
});
