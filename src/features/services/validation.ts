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
  name?: string;
  durationMinutes?: string;
  price?: string;
  bufferBeforeMinutes?: string;
  bufferAfterMinutes?: string;
}

function validateBuffer(minutes: number): string | undefined {
  if (!Number.isInteger(minutes) || minutes < 0) return 'Use a whole number of minutes.';
  if (minutes > MAX_DURATION_MINUTES) return 'That buffer is longer than a day.';
  return undefined;
}

export function validateService(draft: ServiceDraft): ServiceErrors {
  const errors: ServiceErrors = {};

  if (draft.name.trim().length === 0) {
    errors.name = 'Give the service a name.';
  }

  if (!Number.isInteger(draft.durationMinutes) || draft.durationMinutes <= 0) {
    errors.durationMinutes = 'Enter how many minutes it takes.';
  } else if (draft.durationMinutes > MAX_DURATION_MINUTES) {
    errors.durationMinutes = 'A service cannot be longer than a day.';
  }

  if (!Number.isFinite(draft.price) || draft.price < 0) {
    errors.price = 'Enter a price of zero or more.';
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
