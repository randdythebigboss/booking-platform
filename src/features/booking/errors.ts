/**
 * Failure modes of `public.book_appointment`, mapped to something a customer
 * can act on. Anything unrecognised becomes `UNKNOWN` rather than leaking a
 * database message into the UI.
 */
export const BOOKING_ERROR_CODES = [
  'SLOT_TAKEN',
  'SLOT_BLOCKED',
  'OUTSIDE_AVAILABILITY',
  'SLOT_NOT_ALIGNED',
  'TOO_SOON',
  'BEYOND_HORIZON',
  'SERVICE_NOT_AVAILABLE',
  'PROFESSIONAL_NOT_BOOKABLE',
  'BUSINESS_NOT_PUBLIC',
  'CUSTOMER_NAME_REQUIRED',
  'CUSTOMER_PHONE_REQUIRED',
  'APPOINTMENT_NOT_FOUND',
  'APPOINTMENT_NOT_CANCELLABLE',
  'APPOINTMENT_ALREADY_STARTED',
  'APPOINTMENT_NOT_RESCHEDULABLE',
  'UNKNOWN',
] as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];

const BOOKING_ERROR_MESSAGES: Record<BookingErrorCode, string> = {
  SLOT_TAKEN: 'That time was just booked by someone else. Please pick another one.',
  SLOT_BLOCKED: 'That time is no longer available. Please pick another one.',
  OUTSIDE_AVAILABILITY: 'That time is outside the working hours for this professional.',
  SLOT_NOT_ALIGNED:
    'That is not one of the times this professional offers. Please pick one from the list.',
  TOO_SOON: 'That time is too close to now to be booked online.',
  BEYOND_HORIZON: 'That date is further ahead than this professional accepts bookings.',
  SERVICE_NOT_AVAILABLE: 'This service is not offered by that professional.',
  PROFESSIONAL_NOT_BOOKABLE: 'This professional is not accepting bookings right now.',
  BUSINESS_NOT_PUBLIC: 'This booking page is not available.',
  CUSTOMER_NAME_REQUIRED: 'Please enter your name.',
  CUSTOMER_PHONE_REQUIRED: 'Please enter a phone number.',
  APPOINTMENT_NOT_FOUND: 'We could not find that appointment.',
  APPOINTMENT_NOT_CANCELLABLE: 'This appointment can no longer be cancelled.',
  APPOINTMENT_ALREADY_STARTED: 'This appointment has already started.',
  APPOINTMENT_NOT_RESCHEDULABLE: 'This appointment can no longer be changed.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

export class BookingError extends Error {
  readonly code: BookingErrorCode;

  constructor(code: BookingErrorCode) {
    super(BOOKING_ERROR_MESSAGES[code]);
    this.name = 'BookingError';
    this.code = code;
  }

  /** True when retrying with a different time is the right next step. */
  get isSlotConflict(): boolean {
    return (
      this.code === 'SLOT_TAKEN' || this.code === 'SLOT_BLOCKED' || this.code === 'SLOT_NOT_ALIGNED'
    );
  }
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' ? message.trim() : undefined;
}

/**
 * Turns a PostgREST error into a `BookingError` with a known code.
 *
 * The database raises bare sentinel strings (`SLOT_TAKEN`) precisely so that
 * this mapping is exact and the UI never has to pattern-match prose.
 */
export function toBookingError(error: unknown): BookingError {
  if (error instanceof BookingError) return error;

  const raw = errorMessage(error);
  const match = BOOKING_ERROR_CODES.find((code) => code !== 'UNKNOWN' && raw === code);
  return new BookingError(match ?? 'UNKNOWN');
}
