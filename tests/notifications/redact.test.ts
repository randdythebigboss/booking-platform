import { describe, expect, it } from 'vitest';

import { redactEmail, redactPhone, redactRecipient, safeErrorReason } from '@/features/notifications';

/**
 * A dispatcher's log is read while something is wrong, often by somebody who
 * has no business learning a customer's address. Enough survives to match a
 * line against the outbox; nothing survives that could reach the person.
 */

describe('redactEmail', () => {
  it('keeps the first letter and the domain, and nothing else', () => {
    expect(redactEmail('lucia.fernandez@example.test')).toBe('l***@example.test');
  });

  it('does not pretend something without an @ is an address', () => {
    expect(redactEmail('nonsense')).toBe('***');
    expect(redactEmail('@nope')).toBe('***');
  });
});

describe('redactPhone', () => {
  it('keeps the last four digits, whatever the punctuation was', () => {
    expect(redactPhone('+1 (809) 555-0144')).toBe('***0144');
    expect(redactPhone('809-555-0144')).toBe('***0144');
  });

  it('shows nothing of a number too short to be one', () => {
    expect(redactPhone('0144')).toBe('***');
  });
});

describe('redactRecipient', () => {
  it('works out which kind of address it is holding', () => {
    expect(redactRecipient('ana@example.test')).toBe('a***@example.test');
    expect(redactRecipient('+1 809 555 0199')).toBe('***0199');
  });
});

describe('safeErrorReason', () => {
  it('flattens a reason to one short line', () => {
    const reason = safeErrorReason(new Error('smtp: connection\n  reset  by peer'));
    expect(reason).toBe('smtp: connection reset by peer');
  });

  it('truncates a provider that answered with an essay', () => {
    // `last_error` is readable by everyone who can read the business's
    // notifications, and a long provider response tends to echo the request --
    // which is to say, the message.
    const reason = safeErrorReason(new Error('x'.repeat(5000)));
    expect(reason.length).toBe(200);
  });

  it('says something rather than nothing for a thrown non-error', () => {
    expect(safeErrorReason(undefined)).toBe('unknown error');
    expect(safeErrorReason('   ')).toBe('unknown error');
  });
});
