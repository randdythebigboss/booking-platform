import { contains, normalize, overlaps, subtract, type Interval } from './intervals';
import {
  MS_PER_MINUTE,
  addDays,
  isDateWithin,
  isoDateIn,
  parseClockTime,
  weekdayOf,
  zonedInstant,
} from './time';
import {
  DEFAULT_BOOKING_POLICY,
  type BookingPolicy,
  type ComputeSlotsInput,
  type DateException,
  type Slot,
  type WeeklyRule,
} from './types';

export class InvalidAvailabilityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAvailabilityInputError';
  }
}

/**
 * Computes the bookable start times for one professional, one service, one day.
 *
 * Availability is never stored -- it is derived, every time, from:
 *   weekly rules + exceptions + busy time + service duration + buffers
 *   + minimum notice + booking horizon + timezone.
 *
 * The result is advisory: it tells the UI what to offer. The authoritative
 * check happens inside the `book_appointment` database function, which is what
 * actually prevents double booking (see docs/ARCHITECTURE.md).
 */
export function computeAvailableSlots(input: ComputeSlotsInput): Slot[] {
  const policy: BookingPolicy = { ...DEFAULT_BOOKING_POLICY, ...input.policy };
  assertValidInput(input, policy);

  if (!isWithinBookingHorizon(input.date, input.timezone, input.now, policy)) {
    return [];
  }

  const workingWindows = resolveWorkingWindows(
    input.date,
    input.timezone,
    input.rules,
    input.exceptions ?? [],
  );
  if (workingWindows.length === 0) {
    return [];
  }

  const busy = normalize(
    (input.busy ?? []).map((period) => ({
      start: period.startsAt.getTime(),
      end: period.endsAt.getTime(),
    })),
  );

  const { durationMinutes, bufferBeforeMinutes, bufferAfterMinutes } = input.service;
  const durationMs = durationMinutes * MS_PER_MINUTE;
  const bufferBeforeMs = bufferBeforeMinutes * MS_PER_MINUTE;
  const bufferAfterMs = bufferAfterMinutes * MS_PER_MINUTE;
  const stepMs = policy.slotIntervalMinutes * MS_PER_MINUTE;
  const earliestStart = input.now.getTime() + policy.minimumNoticeMinutes * MS_PER_MINUTE;

  const slots: Slot[] = [];

  for (const window of workingWindows) {
    // Align candidate starts to the window opening, not to the clock hour:
    // a shift starting at 09:10 should offer 09:10, not 09:15.
    for (let start = window.start; start + durationMs <= window.end; start += stepMs) {
      if (start < earliestStart) continue;

      const service: Interval = { start, end: start + durationMs };
      if (!contains(window, service)) continue;

      // Buffers may spill outside working hours, but must not touch busy time.
      const occupied: Interval = {
        start: start - bufferBeforeMs,
        end: start + durationMs + bufferAfterMs,
      };
      if (busy.some((taken) => overlaps(occupied, taken))) continue;

      slots.push({ startsAt: new Date(service.start), endsAt: new Date(service.end) });
    }
  }

  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * Turns weekly rules and exceptions into absolute working windows for a date.
 * Exported for tests and for the calendar UI, which shows the shift itself.
 */
export function resolveWorkingWindows(
  date: string,
  timezone: string,
  rules: readonly WeeklyRule[],
  exceptions: readonly DateException[],
): Interval[] {
  const forDate = exceptions.filter((exception) => exception.date === date);

  const fullDayClosure = forDate.some(
    (exception) => exception.type === 'unavailable' && !exception.startTime && !exception.endTime,
  );
  if (fullDayClosure) {
    return [];
  }

  const overrides = forDate.filter(
    (exception) => exception.type === 'available' && exception.startTime && exception.endTime,
  );

  const base: Interval[] =
    overrides.length > 0
      ? overrides.map((exception) =>
          toInterval(date, exception.startTime as string, exception.endTime as string, timezone),
        )
      : rulesForDate(date, timezone, rules).map((rule) =>
          toInterval(date, rule.startTime, rule.endTime, timezone),
        );

  const closures = forDate
    .filter(
      (exception) => exception.type === 'unavailable' && exception.startTime && exception.endTime,
    )
    .map((exception) =>
      toInterval(date, exception.startTime as string, exception.endTime as string, timezone),
    );

  return subtract(base, closures);
}

function rulesForDate(date: string, timezone: string, rules: readonly WeeklyRule[]): WeeklyRule[] {
  const weekday = weekdayOf(date, timezone);
  return rules.filter(
    (rule) =>
      rule.weekday === weekday && isDateWithin(date, rule.effectiveFrom, rule.effectiveUntil),
  );
}

function toInterval(date: string, startTime: string, endTime: string, timezone: string): Interval {
  const startMinutes = parseClockTime(startTime);
  const endMinutes = parseClockTime(endTime);

  if (endMinutes <= startMinutes) {
    // Overnight shifts are not supported in the MVP; a window that does not
    // move forward is dropped rather than silently wrapping to the next day.
    return { start: 0, end: 0 };
  }

  return {
    start: zonedInstant(date, startMinutes, timezone).getTime(),
    end: zonedInstant(date, endMinutes, timezone).getTime(),
  };
}

function isWithinBookingHorizon(
  date: string,
  timezone: string,
  now: Date,
  policy: BookingPolicy,
): boolean {
  const today = isoDateIn(now, timezone);
  if (date < today) return false;
  return date <= addDays(today, policy.bookingHorizonDays);
}

function assertValidInput(input: ComputeSlotsInput, policy: BookingPolicy): void {
  const { durationMinutes, bufferBeforeMinutes, bufferAfterMinutes } = input.service;

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new InvalidAvailabilityInputError(
      'Service duration must be a positive number of minutes.',
    );
  }
  if (bufferBeforeMinutes < 0 || bufferAfterMinutes < 0) {
    throw new InvalidAvailabilityInputError('Buffers cannot be negative.');
  }
  if (!Number.isFinite(policy.slotIntervalMinutes) || policy.slotIntervalMinutes <= 0) {
    throw new InvalidAvailabilityInputError('Slot interval must be a positive number of minutes.');
  }
  if (policy.minimumNoticeMinutes < 0 || policy.bookingHorizonDays < 0) {
    throw new InvalidAvailabilityInputError(
      'Minimum notice and booking horizon cannot be negative.',
    );
  }
}
