import { describe, expect, it } from 'vitest';

import { isNetworkFailure, toBookingError } from '@/features/booking';
import { toWorkspaceError } from '@/features/workspace';

/**
 * "You are offline" and "that time is taken" arrive at the same catch block.
 * Telling somebody to check their connection about a slot that is genuinely
 * gone is worse than saying nothing, so this errs firmly towards the server's
 * answer: anything carrying a code or a status is an answer.
 */

describe('isNetworkFailure', () => {
  it('recognises what a failed fetch looks like on each platform', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFailure(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkFailure({ message: 'NetworkError when attempting to fetch resource.' })).toBe(
      true,
    );
    expect(isNetworkFailure({ message: 'Load failed' })).toBe(true);
  });

  it('never mistakes an answer for a missing connection', () => {
    // A PostgREST error has a code. Whatever it says, the server said it.
    expect(isNetworkFailure({ code: '23P01', message: 'SLOT_TAKEN' })).toBe(false);
    expect(isNetworkFailure({ code: 'PGRST202', message: 'Failed to fetch function' })).toBe(false);
    expect(isNetworkFailure({ status: 400, message: 'failed to fetch' })).toBe(false);
  });

  it('does not guess from nothing', () => {
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
    expect(isNetworkFailure({})).toBe(false);
    expect(isNetworkFailure(new Error('something odd'))).toBe(false);
  });
});

describe('what a screen is told', () => {
  it('maps a transport failure to OFFLINE, for a guest and a professional alike', () => {
    expect(toBookingError(new TypeError('Failed to fetch')).code).toBe('OFFLINE');
    expect(toWorkspaceError(new TypeError('Failed to fetch')).code).toBe('OFFLINE');
  });

  it('still maps the server codes it always did', () => {
    expect(toBookingError({ message: 'SLOT_TAKEN' }).code).toBe('SLOT_TAKEN');
    expect(toBookingError({ message: 'PAYMENT_NOT_AVAILABLE' }).code).toBe('PAYMENT_NOT_AVAILABLE');
    expect(toBookingError({ message: 'something nobody has seen' }).code).toBe('UNKNOWN');
  });
});
