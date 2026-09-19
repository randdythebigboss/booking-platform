/**
 * Shared domain vocabulary.
 *
 * These types mirror the database enums defined in
 * `supabase/migrations/0001_initial_schema.sql`. Keep both in sync: the
 * database is the source of truth, this file is the TypeScript view of it.
 */

/** Calendar date in the business timezone, `YYYY-MM-DD`. */
export type IsoDate = string;

/** Wall-clock time in the business timezone, `HH:mm` or `HH:mm:ss`. */
export type ClockTime = string;

/** `0` = Sunday ... `6` = Saturday, matching `Date.prototype.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const BUSINESS_MEMBER_ROLES = ['owner', 'admin', 'professional'] as const;
export type BusinessMemberRole = (typeof BUSINESS_MEMBER_ROLES)[number];

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that occupy the calendar and therefore block other bookings. */
export const BLOCKING_APPOINTMENT_STATUSES = ['pending', 'confirmed'] as const;

export const APPOINTMENT_SOURCES = ['public_page', 'manual', 'import'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const AVAILABILITY_EXCEPTION_TYPES = ['available', 'unavailable'] as const;
export type AvailabilityExceptionType = (typeof AVAILABILITY_EXCEPTION_TYPES)[number];

export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'paid',
  'failed',
  'refunded',
  'cancelled',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
