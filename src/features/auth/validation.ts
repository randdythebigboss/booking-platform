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
