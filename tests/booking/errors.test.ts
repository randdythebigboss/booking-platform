import { describe, expect, it } from 'vitest';

import { BookingError, toBookingError } from '@/features/booking';

describe('toBookingError', () => {
  it('maps the sentinel the database raises', () => {
    const error = toBookingError({ message: 'SLOT_TAKEN', code: 'P0001' });
    expect(error.code).toBe('SLOT_TAKEN');
    expect(error.message).toMatch(/just booked by someone else/);
  });

  it('tolerates the whitespace PostgREST sometimes adds', () => {
    expect(toBookingError({ message: '  TOO_SOON  ' }).code).toBe('TOO_SOON');
  });

  it('falls back to UNKNOWN instead of leaking a database message', () => {
    const error = toBookingError({
      message: 'duplicate key value violates unique constraint "customers_pkey"',
    });
    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toBe('Something went wrong. Please try again.');
  });

  it('handles a network failure with no message at all', () => {
    expect(toBookingError(undefined).code).toBe('UNKNOWN');
    expect(toBookingError(new Error()).code).toBe('UNKNOWN');
  });

  it('passes an existing BookingError straight through', () => {
    const original = new BookingError('BEYOND_HORIZON');
    expect(toBookingError(original)).toBe(original);
  });
});

describe('BookingError.isSlotConflict', () => {
  it('is true exactly for the two cases where picking another time helps', () => {
    expect(new BookingError('SLOT_TAKEN').isSlotConflict).toBe(true);
    expect(new BookingError('SLOT_BLOCKED').isSlotConflict).toBe(true);
    expect(new BookingError('TOO_SOON').isSlotConflict).toBe(false);
  });
});
