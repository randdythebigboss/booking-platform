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
  // Phase 9. Money has its own ways of going wrong, and a customer can act on
  // every one of these: try another card, pick another time, come back later.
  'CARD_DECLINED',
  'PAYMENT_HOLD_EXPIRED',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'PAYMENT_SIMULATION_DISABLED',
  'NO_PAYMENT_DUE',
  'PAYMENT_NOT_RETRYABLE',
  'APPOINTMENT_NOT_PAYABLE',
  'UNKNOWN',
] as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];

/**
 * The error a customer can act on.
 *
 * It carries only the code. The words live in `src/locales`, keyed by that
 * same code, because the database raises `SLOT_TAKEN` and a guest may be
 * reading in Spanish or English. `Error.message` is the code too, which is
 * what a log wants and what no screen should ever render.
 */
export class BookingError extends Error {
  readonly code: BookingErrorCode;

  constructor(code: BookingErrorCode) {
    super(code);
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
