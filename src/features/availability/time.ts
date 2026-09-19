import { TZDate } from '@date-fns/tz';

import type { ClockTime, IsoDate, Weekday } from '@/types/domain';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export const MINUTES_PER_DAY = 24 * 60;
export const MS_PER_MINUTE = 60_000;

export class InvalidTimeValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTimeValueError';
  }
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Parses `YYYY-MM-DD`. Throws on anything else. */
export function parseIsoDate(value: IsoDate): CalendarDate {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    throw new InvalidTimeValueError(`Expected a YYYY-MM-DD date, received "${value}".`);
  }
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/**
 * Parses `HH:mm` or `HH:mm:ss` into minutes since midnight.
 * `24:00` is accepted and means end-of-day.
 */
export function parseClockTime(value: ClockTime): number {
  const match = CLOCK_TIME_PATTERN.exec(value);
  if (!match) {
    throw new InvalidTimeValueError(`Expected an HH:mm time, received "${value}".`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const total = hours * 60 + minutes;

  if (minutes > 59 || total > MINUTES_PER_DAY) {
    throw new InvalidTimeValueError(`Time "${value}" is outside 00:00-24:00.`);
  }
  return total;
}

/** Formats minutes since midnight back to `HH:mm`. */
export function formatClockTime(minutesFromMidnight: number): ClockTime {
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Resolves a wall-clock moment in a business timezone to an absolute instant.
 *
 * `minutesFromMidnight` may exceed 1440; the extra rolls into the next day,
 * which is what makes `24:00` work as an end time.
 */
export function zonedInstant(date: IsoDate, minutesFromMidnight: number, timezone: string): Date {
  const { year, month, day } = parseIsoDate(date);
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  const zoned = TZDate.tz(timezone, year, month - 1, day, hours, minutes, 0, 0);

  // TZDate carries its own offset; collapse it to a plain UTC-based Date so
  // callers never have to think about which representation they hold.
  return new Date(zoned.getTime());
}

/** The weekday a calendar date falls on, as seen from the business timezone. */
export function weekdayOf(date: IsoDate, timezone: string): Weekday {
  const { year, month, day } = parseIsoDate(date);
  // Midday keeps us clear of DST transitions, which happen near midnight.
  const zoned = TZDate.tz(timezone, year, month - 1, day, 12, 0, 0, 0);
  return zoned.getDay() as Weekday;
}

/** Calendar-date arithmetic, independent of any timezone. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** The calendar date an instant falls on, as seen from the business timezone. */
export function isoDateIn(instant: Date, timezone: string): IsoDate {
  // `en-CA` renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Inclusive comparison helper for `effective_from` / `effective_until`. */
export function isDateWithin(
  date: IsoDate,
  from: IsoDate | null | undefined,
  until: IsoDate | null | undefined,
): boolean {
  if (from && date < from) return false;
  if (until && date > until) return false;
  return true;
}
