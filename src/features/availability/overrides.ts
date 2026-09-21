import { parseClockTime, zonedInstant } from './time';

import type { ClockTime, IsoDate } from '@/types/domain';

/**
 * Date-specific changes to a schedule, of which there are exactly two kinds,
 * and they are not interchangeable:
 *
 *   Weekly rule       "I work Mondays 09:00-18:00."       availability_rules
 *   Date exception    "This Tuesday I open 12:00-20:00,   availability_exceptions
 *                      or not at all."
 *   Blocked time      "I am out 12:00-14:30 that day."    blocked_times
 *
 * An exception changes what the schedule SAYS for a date. A block carves time
 * out of whatever the schedule already said. Collapsing them would make a
 * calendar unable to explain why a slot is missing.
 */

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface BlockDraft {
  /** Calendar date in the business timezone. */
  date: IsoDate;
  startTime: ClockTime;
  endTime: ClockTime;
  reason?: string;
}

export interface BlockErrors {
  date?: string;
  startTime?: string;
  endTime?: string;
}

function validateDate(date: string): string | undefined {
  if (!ISO_DATE_PATTERN.test(date)) return 'Pick a date.';
  return undefined;
}

function validateTime(value: string, label: string): string | undefined {
  try {
    parseClockTime(value);
    return undefined;
  } catch {
    return `Enter ${label} as HH:mm.`;
  }
}

export function validateBlock(draft: BlockDraft): BlockErrors {
  const errors: BlockErrors = {};

  const dateError = validateDate(draft.date);
  if (dateError) errors.date = dateError;

  const startError = validateTime(draft.startTime, 'the start time');
  const endError = validateTime(draft.endTime, 'the end time');
  if (startError) errors.startTime = startError;
  if (endError) errors.endTime = endError;

  if (!startError && !endError) {
    if (parseClockTime(draft.endTime) <= parseClockTime(draft.startTime)) {
      errors.endTime = 'The end time has to come after the start time.';
    }
  }

  return errors;
}

/**
 * Resolves a block to absolute instants against the BUSINESS timezone.
 *
 * The device's own zone is never consulted: a professional in Madrid editing
 * a Santo Domingo calendar must still block Santo Domingo hours.
 */
export function toBlockRange(
  draft: BlockDraft,
  timezone: string,
): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: zonedInstant(draft.date, parseClockTime(draft.startTime), timezone),
    endsAt: zonedInstant(draft.date, parseClockTime(draft.endTime), timezone),
  };
}

export type ExceptionKind = 'closed' | 'custom-hours';

export interface ExceptionDraft {
  date: IsoDate;
  kind: ExceptionKind;
  /** Required for `custom-hours`, ignored for `closed`. */
  startTime?: ClockTime;
  endTime?: ClockTime;
  reason?: string;
}

export interface ExceptionErrors {
  date?: string;
  startTime?: string;
  endTime?: string;
}

export function validateException(draft: ExceptionDraft): ExceptionErrors {
  const errors: ExceptionErrors = {};

  const dateError = validateDate(draft.date);
  if (dateError) errors.date = dateError;

  if (draft.kind === 'closed') {
    return errors;
  }

  if (!draft.startTime || !draft.endTime) {
    if (!draft.startTime) errors.startTime = 'Enter the opening time.';
    if (!draft.endTime) errors.endTime = 'Enter the closing time.';
    return errors;
  }

  const startError = validateTime(draft.startTime, 'the opening time');
  const endError = validateTime(draft.endTime, 'the closing time');
  if (startError) errors.startTime = startError;
  if (endError) errors.endTime = endError;

  if (!startError && !endError) {
    if (parseClockTime(draft.endTime) <= parseClockTime(draft.startTime)) {
      errors.endTime = 'The closing time has to come after the opening time.';
    }
  }

  return errors;
}

/** One sentence a professional can read back to check they meant it. */
export function describeException(draft: ExceptionDraft): string {
  return draft.kind === 'closed'
    ? `Closed all day on ${draft.date}.`
    : `Open ${draft.startTime} to ${draft.endTime} on ${draft.date}, instead of the usual hours.`;
}
