import { issue, type ValidationIssue } from '../validation';

/** Client-side credential checks. Supabase Auth is still the authority. */

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Deliberately permissive: the only email that truly validates is one that
 * receives mail. This catches typos, not exotic-but-legal addresses.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface CredentialErrors {
  email?: ValidationIssue;
  password?: ValidationIssue;
}

export function validateEmail(email: string): ValidationIssue | undefined {
  const trimmed = email.trim();
  if (trimmed.length === 0) return issue('email.required');
  if (!EMAIL_PATTERN.test(trimmed)) return issue('email.invalid');
  return undefined;
}

export function validatePassword(password: string): ValidationIssue | undefined {
  if (password.length === 0) return issue('password.required');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return issue('password.tooShort', { min: MIN_PASSWORD_LENGTH });
  }
  return undefined;
}

export function validateCredentials(email: string, password: string): CredentialErrors {
  const errors: CredentialErrors = {};
  const emailError = validateEmail(email);
  const passwordError = validatePassword(password);
  if (emailError) errors.email = emailError;
  if (passwordError) errors.password = passwordError;
  return errors;
}

export { hasIssues as hasErrors } from '../validation';

/**
 * Reserved domains, per RFC 2606 and RFC 6761. Mail never leaves for these,
 * which is exactly why they are the only addresses this demonstration accepts.
 */
const RESERVED_DOMAINS = /(^|\.)(test|example|invalid|localhost)$/i;

/**
 * Whether an address may register on this deployment.
 *
 * ---------------------------------------------------------------------------
 * Why registration is restricted at all
 * ---------------------------------------------------------------------------
 *
 * The hosted demonstration has public sign-up enabled with email confirmation
 * turned off, so GoTrue issues a usable session for any address immediately,
 * whether or not the person owns it. Nobody can reach another person's data
 * that way -- an appointment is claimed with the booking credential and never
 * with an address, and the database enforces that -- but somebody could still
 * register `owner@a-real-salon.com` and appear, to a human reading the screen,
 * to be them.
 *
 * Confirmation cannot be switched on from inside the application: it is
 * provider configuration, and turning it on without a mail provider would lock
 * every new account out instead of verifying it. So until an email provider
 * exists, registration is confined to addresses that cannot belong to anybody:
 * the reserved test domains. Fictional data is the rule for this phase anyway.
 *
 * ---------------------------------------------------------------------------
 * What this is not
 * ---------------------------------------------------------------------------
 *
 * A security boundary. It runs in the client, and the API is still the API.
 * It stops the accident and the casual impersonation; it does not stop
 * somebody determined, and the only thing that will is provider-side
 * verification. It restricts registration only -- signing in is untouched, so
 * no existing account can be locked out by it.
 */
export function isDemoRegistrationAllowed(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return false;
  return RESERVED_DOMAINS.test(domain);
}
