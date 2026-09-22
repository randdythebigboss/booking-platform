/**
 * What a guest has to give us, and no more.
 *
 * A name and a way to reach them is enough to hold an appointment. Every
 * extra required field is a customer who does not finish booking, so email
 * stays optional and there is no account.
 */

import { issue, type ValidationIssue } from '../validation';

export interface CustomerDraft {
  fullName: string;
  phone: string;
  email: string;
}

export interface CustomerErrors {
  fullName?: ValidationIssue;
  phone?: ValidationIssue;
  email?: ValidationIssue;
}

export const EMPTY_CUSTOMER: CustomerDraft = { fullName: '', phone: '', email: '' };

// Deliberately loose: numbers, spaces, dashes, dots, brackets and a leading +.
// International formats vary far too much to police here, and the cost of a
// false rejection is a lost booking.
const PHONE_PATTERN = /^\+?[\d(][\d\s().-]{5,}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function countPhoneDigits(phone: string): number {
  return (phone.match(/\d/g) ?? []).length;
}

export function validateCustomer(draft: CustomerDraft): CustomerErrors {
  const errors: CustomerErrors = {};

  if (draft.fullName.trim().length === 0) {
    errors.fullName = issue('name.required');
  } else if (draft.fullName.trim().length < 2) {
    errors.fullName = issue('name.tooShort');
  }

  const phone = draft.phone.trim();
  if (phone.length === 0) {
    errors.phone = issue('phone.required');
  } else if (!PHONE_PATTERN.test(phone) || countPhoneDigits(phone) < 7) {
    errors.phone = issue('phone.invalid');
  }

  const email = draft.email.trim();
  if (email.length > 0 && !EMAIL_PATTERN.test(email)) {
    errors.email = issue('email.invalid');
  }

  return errors;
}

export function isCustomerComplete(draft: CustomerDraft): boolean {
  return Object.keys(validateCustomer(draft)).length === 0;
}
