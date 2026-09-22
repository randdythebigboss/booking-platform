import { describe, expect, it } from 'vitest';

import { BookingError, toBookingError } from '@/features/booking';

describe('toBookingError', () => {
  it('maps the sentinel the database raises', () => {
    const error = toBookingError({ message: 'SLOT_TAKEN', code: 'P0001' });
    expect(error.code).toBe('SLOT_TAKEN');
    expect(error.message).toBe('SLOT_TAKEN');
  });

  it('maps the refusal a guest gets when their appointment is closed', () => {
    const error = toBookingError({ message: 'APPOINTMENT_NOT_RESCHEDULABLE' });
    expect(error.code).toBe('APPOINTMENT_NOT_RESCHEDULABLE');
  });

  it('tells a guest whose move lost a race to pick again', () => {
    // The appointment is still theirs, at the time it had. The message has to
    // say "pick another", not anything that sounds like a loss.
    expect(toBookingError({ message: 'SLOT_TAKEN' }).isSlotConflict).toBe(true);
  });

  it('tolerates the whitespace PostgREST sometimes adds', () => {
    expect(toBookingError({ message: '  TOO_SOON  ' }).code).toBe('TOO_SOON');
  });

  it('falls back to UNKNOWN instead of leaking a database message', () => {
    const error = toBookingError({
      message: 'duplicate key value violates unique constraint "customers_pkey"',
    });
    expect(error.code).toBe('UNKNOWN');
    // The message is the code, never prose, and never the database's words.
    expect(error.message).toBe('UNKNOWN');
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
  it('is true exactly for the cases where picking another time helps', () => {
    expect(new BookingError('SLOT_TAKEN').isSlotConflict).toBe(true);
    expect(new BookingError('SLOT_BLOCKED').isSlotConflict).toBe(true);
    expect(new BookingError('SLOT_NOT_ALIGNED').isSlotConflict).toBe(true);
    expect(new BookingError('TOO_SOON').isSlotConflict).toBe(false);
    expect(new BookingError('BEYOND_HORIZON').isSlotConflict).toBe(false);
  });
});

describe('SLOT_NOT_ALIGNED', () => {
  it('maps the sentinel the alignment gate raises', () => {
    const error = toBookingError({ message: 'SLOT_NOT_ALIGNED' });
    expect(error.code).toBe('SLOT_NOT_ALIGNED');
    expect(error.isSlotConflict).toBe(true);
  });
});
