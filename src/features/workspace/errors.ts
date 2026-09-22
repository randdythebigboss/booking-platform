/**
 * Professional-side failures.
 *
 * The Phase 1 database functions raise bare sentinels, exactly like the
 * booking API, so the mapping stays exact. Supabase Auth does not -- it
 * returns prose -- so those are matched on a few well-known phrases and
 * everything else lands on UNKNOWN.
 */
export const WORKSPACE_ERROR_CODES = [
  'NOT_AUTHENTICATED',
  'NOT_ALLOWED',
  'SLUG_TAKEN',
  'INVALID_SLUG',
  'BUSINESS_NAME_REQUIRED',
  'DISPLAY_NAME_REQUIRED',
  'BUSINESS_NOT_FOUND',
  'SERVICE_NAME_REQUIRED',
  'SERVICE_NOT_FOUND',
  'INVALID_SCHEDULE',
  'INVALID_WEEKDAY',
  'INVALID_TIME_RANGE',
  'BLOCK_CONFLICTS_WITH_APPOINTMENT',
  'INVALID_STATUS_TRANSITION',
  'APPOINTMENT_HAS_NOT_STARTED',
  'APPOINTMENT_NOT_FOUND',
  'APPOINTMENT_NOT_RESCHEDULABLE',
  'BUSINESS_NOT_ACTIVE',
  'PROFESSIONAL_NOT_FOUND',
  'SERVICE_NOT_AVAILABLE',
  'CUSTOMER_NAME_REQUIRED',
  'CUSTOMER_PHONE_REQUIRED',
  'SLOT_TAKEN',
  'SLOT_BLOCKED',
  'OUTSIDE_AVAILABILITY',
  'INVALID_TIMEZONE',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'EMAIL_NOT_CONFIRMED',
  'WEAK_PASSWORD',
  'UNKNOWN',
] as const;

export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number];

const MESSAGES: Record<WorkspaceErrorCode, string> = {
  NOT_AUTHENTICATED: 'Please sign in again.',
  NOT_ALLOWED: 'You do not have permission to do that.',
  SLUG_TAKEN: 'That public link is already taken. Try another one.',
  INVALID_SLUG: 'Use lowercase letters, numbers and single dashes only.',
  BUSINESS_NAME_REQUIRED: 'Give your business a name.',
  DISPLAY_NAME_REQUIRED: 'Enter the name customers will see.',
  BUSINESS_NOT_FOUND: 'We could not find that business.',
  SERVICE_NAME_REQUIRED: 'Give the service a name.',
  SERVICE_NOT_FOUND: 'That service no longer exists.',
  INVALID_SCHEDULE: 'That schedule could not be read.',
  INVALID_WEEKDAY: 'That is not a valid day of the week.',
  INVALID_TIME_RANGE: 'The end time has to come after the start time.',
  INVALID_STATUS_TRANSITION: 'That is not a change this appointment can make from where it is now.',
  APPOINTMENT_HAS_NOT_STARTED:
    'This appointment has not started yet, so it cannot be completed or marked as a no-show.',
  APPOINTMENT_NOT_FOUND: 'We could not find that appointment.',
  APPOINTMENT_NOT_RESCHEDULABLE:
    'This appointment is closed, so it cannot be moved. Book a new one instead.',
  BUSINESS_NOT_ACTIVE: 'This business is not active.',
  PROFESSIONAL_NOT_FOUND: 'We could not find that professional in this business.',
  SERVICE_NOT_AVAILABLE: 'That service is not one this professional offers.',
  CUSTOMER_NAME_REQUIRED: 'Enter the customer name.',
  CUSTOMER_PHONE_REQUIRED: 'Enter a phone number.',
  SLOT_TAKEN: 'There is already an appointment at that time.',
  SLOT_BLOCKED:
    'You blocked that period. Remove the block first if you want to book over it.',
  OUTSIDE_AVAILABILITY:
    'That falls outside your working hours. Allow it explicitly if you meant to.',
  BLOCK_CONFLICTS_WITH_APPOINTMENT:
    'There is already an appointment in that period. Cancel it first if you really want the time back.',
  INVALID_TIMEZONE: 'That is not a timezone we recognise.',
  INVALID_CREDENTIALS: 'That email and password do not match an account.',
  EMAIL_TAKEN: 'There is already an account with that email.',
  EMAIL_NOT_CONFIRMED: 'Confirm your email address first, then sign in.',
  WEAK_PASSWORD: 'Choose a longer password.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode) {
    super(MESSAGES[code]);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

/** Prose Supabase Auth returns, matched loosely because it is not a contract. */
const AUTH_PHRASES: [RegExp, WorkspaceErrorCode][] = [
  [/invalid login credentials/i, 'INVALID_CREDENTIALS'],
  [/already registered|already been registered/i, 'EMAIL_TAKEN'],
  [/email not confirmed/i, 'EMAIL_NOT_CONFIRMED'],
  [/password should be at least|weak password/i, 'WEAK_PASSWORD'],
];

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function messageOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message.trim() : undefined;
}

export function toWorkspaceError(error: unknown): WorkspaceError {
  if (error instanceof WorkspaceError) return error;

  if (codeOf(error) === '23505') return new WorkspaceError('SLUG_TAKEN');

  const raw = messageOf(error);
  if (!raw) return new WorkspaceError('UNKNOWN');

  const sentinel = WORKSPACE_ERROR_CODES.find((code) => code !== 'UNKNOWN' && raw === code);
  if (sentinel) return new WorkspaceError(sentinel);

  // The timezone trigger raises a descriptive message rather than a sentinel.
  if (/invalid iana timezone/i.test(raw)) return new WorkspaceError('INVALID_TIMEZONE');

  for (const [pattern, code] of AUTH_PHRASES) {
    if (pattern.test(raw)) return new WorkspaceError(code);
  }

  return new WorkspaceError('UNKNOWN');
}
