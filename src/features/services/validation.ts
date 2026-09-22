import { issue, type ValidationIssue } from '../validation';

/** Service form rules. The database enforces the same bounds. */

export const MAX_DURATION_MINUTES = 1440;

export interface ServiceDraft {
  name: string;
  durationMinutes: number;
  price: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

export interface ServiceErrors {
  name?: ValidationIssue;
  durationMinutes?: ValidationIssue;
  price?: ValidationIssue;
  bufferBeforeMinutes?: ValidationIssue;
  bufferAfterMinutes?: ValidationIssue;
}

function validateBuffer(minutes: number): ValidationIssue | undefined {
  if (!Number.isInteger(minutes) || minutes < 0) return issue('buffer.invalid');
  if (minutes > MAX_DURATION_MINUTES) return issue('buffer.tooLong');
  return undefined;
}

export function validateService(draft: ServiceDraft): ServiceErrors {
  const errors: ServiceErrors = {};

  if (draft.name.trim().length === 0) {
    errors.name = issue('service.nameRequired');
  }

  if (!Number.isInteger(draft.durationMinutes) || draft.durationMinutes <= 0) {
    errors.durationMinutes = issue('service.durationRequired');
  } else if (draft.durationMinutes > MAX_DURATION_MINUTES) {
    errors.durationMinutes = issue('service.durationTooLong');
  }

  if (!Number.isFinite(draft.price) || draft.price < 0) {
    errors.price = issue('service.priceInvalid');
  }

  const before = validateBuffer(draft.bufferBeforeMinutes);
  const after = validateBuffer(draft.bufferAfterMinutes);
  if (before) errors.bufferBeforeMinutes = before;
  if (after) errors.bufferAfterMinutes = after;

  return errors;
}

/** Parses a text input into a number without turning '' into 0. */
export function parseNumericInput(value: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) return Number.NaN;
  return Number(trimmed.replace(',', '.'));
}
