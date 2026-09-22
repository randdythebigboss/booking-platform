import { issue, type ValidationIssue } from '../validation';
import { parseClockTime } from './time';

import type { ClockTime, Weekday } from '@/types/domain';

/** One working window in the weekly editor. */
export interface ScheduleEntry {
  weekday: Weekday;
  startTime: ClockTime;
  endTime: ClockTime;
}

export interface ScheduleIssue {
  /** Position in the submitted list, so the form can point at the right row. */
  index: number;
  issue: ValidationIssue;
}

/**
 * Translation keys, not words. The weekday a date falls on is domain; what
 * that weekday is called is presentation, and there are two languages of it.
 */
export const WEEKDAY_KEYS = {
  0: 'availability.weekday_0',
  1: 'availability.weekday_1',
  2: 'availability.weekday_2',
  3: 'availability.weekday_3',
  4: 'availability.weekday_4',
  5: 'availability.weekday_5',
  6: 'availability.weekday_6',
} as const satisfies Record<Weekday, string>;

export const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** Monday to Friday 09:00-18:00, Saturday 09:00-14:00, Sunday closed. */
export const DEFAULT_WEEKLY_SCHEDULE: ScheduleEntry[] = [
  { weekday: 1, startTime: '09:00', endTime: '18:00' },
  { weekday: 2, startTime: '09:00', endTime: '18:00' },
  { weekday: 3, startTime: '09:00', endTime: '18:00' },
  { weekday: 4, startTime: '09:00', endTime: '18:00' },
  { weekday: 5, startTime: '09:00', endTime: '18:00' },
  { weekday: 6, startTime: '09:00', endTime: '14:00' },
];

/**
 * Checks a whole week before it is sent.
 *
 * Overlapping windows on the same day are rejected rather than merged: the
 * engine would cope, but a professional who typed 09:00-13:00 twice almost
 * certainly meant something else and should see it.
 */
export function validateWeeklySchedule(entries: readonly ScheduleEntry[]): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const parsed: { index: number; weekday: Weekday; start: number; end: number }[] = [];

  entries.forEach((entry, index) => {
    let start: number;
    let end: number;

    try {
      start = parseClockTime(entry.startTime);
      end = parseClockTime(entry.endTime);
    } catch {
      issues.push({ index, issue: issue('time.invalidStart') });
      return;
    }

    if (end <= start) {
      issues.push({ index, issue: issue('schedule.endBeforeStart') });
      return;
    }

    parsed.push({ index, weekday: entry.weekday, start, end });
  });

  const byWeekday = new Map<Weekday, typeof parsed>();
  for (const entry of parsed) {
    const bucket = byWeekday.get(entry.weekday) ?? [];
    bucket.push(entry);
    byWeekday.set(entry.weekday, bucket);
  }

  for (const bucket of byWeekday.values()) {
    const sorted = [...bucket].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1]!;
      const current = sorted[i]!;
      if (current.start < previous.end) {
        issues.push({ index: current.index, issue: issue('schedule.overlap') });
      }
    }
  }

  return issues.sort((a, b) => a.index - b.index);
}

/** The payload shape `public.set_weekly_schedule` expects. */
export function toSchedulePayload(entries: readonly ScheduleEntry[]) {
  return entries.map((entry) => ({
    weekday: entry.weekday,
    startTime: entry.startTime,
    endTime: entry.endTime,
  }));
}
