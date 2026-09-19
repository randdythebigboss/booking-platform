import type { AvailabilityExceptionType, ClockTime, IsoDate, Weekday } from '@/types/domain';

/** How long a service occupies the calendar, buffers included. */
export interface ServiceTiming {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

/** A recurring weekly working window, expressed in the business timezone. */
export interface WeeklyRule {
  weekday: Weekday;
  startTime: ClockTime;
  endTime: ClockTime;
  effectiveFrom?: IsoDate | null;
  effectiveUntil?: IsoDate | null;
}

/**
 * A one-off change to the weekly schedule.
 *
 * `available` exceptions REPLACE the weekly rules for that date.
 * `unavailable` exceptions are subtracted; without times they close the day.
 */
export interface DateException {
  date: IsoDate;
  type: AvailabilityExceptionType;
  startTime?: ClockTime | null;
  endTime?: ClockTime | null;
}

/**
 * Time already taken on the professional's calendar.
 *
 * Callers pass these already expanded by the buffers of whatever occupies
 * them -- the database stores that expanded range on `appointments`.
 */
export interface BusyPeriod {
  startsAt: Date;
  endsAt: Date;
}

export interface BookingPolicy {
  /** Granularity of offered start times, in minutes. */
  slotIntervalMinutes: number;
  /** How far ahead of `now` the earliest bookable slot must be. */
  minimumNoticeMinutes: number;
  /** How many calendar days into the future may be booked. */
  bookingHorizonDays: number;
}

export const DEFAULT_BOOKING_POLICY: BookingPolicy = {
  slotIntervalMinutes: 15,
  minimumNoticeMinutes: 60,
  bookingHorizonDays: 60,
};

export interface ComputeSlotsInput {
  /** The calendar date being offered, in the business timezone. */
  date: IsoDate;
  /** IANA timezone of the business, e.g. `America/Santo_Domingo`. */
  timezone: string;
  service: ServiceTiming;
  rules: readonly WeeklyRule[];
  exceptions?: readonly DateException[];
  busy?: readonly BusyPeriod[];
  policy?: Partial<BookingPolicy>;
  /** Injected so the engine stays deterministic and testable. */
  now: Date;
}

/** A bookable start time. Buffers are excluded: this is what the customer sees. */
export interface Slot {
  startsAt: Date;
  endsAt: Date;
}
