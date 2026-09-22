import { issue, type ValidationIssue } from '../validation';
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
  date?: ValidationIssue;
  startTime?: ValidationIssue;
  endTime?: ValidationIssue;
}

function validateDate(date: string): ValidationIssue | undefined {
  if (!ISO_DATE_PATTERN.test(date)) return issue('date.invalid');
  return undefined;
}

/** `code` names which field it is, so the message can say so. */
function validateTime(value: string, code: string): ValidationIssue | undefined {
  try {
    parseClockTime(value);
    return undefined;
  } catch {
    return issue(code);
  }
}

export function validateBlock(draft: BlockDraft): BlockErrors {
  const errors: BlockErrors = {};

  const dateError = validateDate(draft.date);
  if (dateError) errors.date = dateError;

  const startError = validateTime(draft.startTime, 'time.invalidStart');
  const endError = validateTime(draft.endTime, 'time.invalidEnd');
  if (startError) errors.startTime = startError;
  if (endError) errors.endTime = endError;

  if (!startError && !endError) {
    if (parseClockTime(draft.endTime) <= parseClockTime(draft.startTime)) {
      errors.endTime = issue('time.endBeforeStart');
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
  date?: ValidationIssue;
  startTime?: ValidationIssue;
  endTime?: ValidationIssue;
}

export function validateException(draft: ExceptionDraft): ExceptionErrors {
  const errors: ExceptionErrors = {};

  const dateError = validateDate(draft.date);
  if (dateError) errors.date = dateError;

  if (draft.kind === 'closed') {
    return errors;
  }

  if (!draft.startTime || !draft.endTime) {
    if (!draft.startTime) errors.startTime = issue('time.openingRequired');
    if (!draft.endTime) errors.endTime = issue('time.closingRequired');
    return errors;
  }

  const startError = validateTime(draft.startTime, 'time.invalidOpening');
  const endError = validateTime(draft.endTime, 'time.invalidClosing');
  if (startError) errors.startTime = startError;
  if (endError) errors.endTime = endError;

  if (!startError && !endError) {
    if (parseClockTime(draft.endTime) <= parseClockTime(draft.startTime)) {
      errors.endTime = issue('time.closingBeforeOpening');
    }
  }

  return errors;
}

/**
 * The ingredients for the sentence a professional reads back to check they
 * meant it. The sentence itself lives in the dictionaries.
 */
export function describeException(draft: ExceptionDraft): ValidationIssue {
  return draft.kind === 'closed'
    ? issue('exceptions.describeClosed', { date: draft.date })
    : issue('exceptions.describeCustom', {
        start: draft.startTime ?? '',
        end: draft.endTime ?? '',
        date: draft.date,
      });
}
