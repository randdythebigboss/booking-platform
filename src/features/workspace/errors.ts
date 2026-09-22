import { isNetworkFailure } from '@/features/booking/network';

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
  // Phase 9.
  'PAYMENT_NOT_FOUND',
  'PAYMENT_NOT_REFUNDABLE',
  'PAYMENT_SIMULATION_DISABLED',
  'OFFLINE',
  'UNKNOWN',
] as const;

export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number];

/**
 * A professional-side failure, carried as a code.
 *
 * Same discipline as `BookingError`: the database and Supabase Auth produce
 * machine-readable identifiers, and the sentence is chosen by the interface in
 * whichever language it is speaking. `Error.message` is the code, which is
 * what a log wants and what no screen should render.
 */
export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode) {
    super(code);
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
  if (isNetworkFailure(error)) return new WorkspaceError('OFFLINE');

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
