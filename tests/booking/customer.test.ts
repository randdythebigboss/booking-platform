import { describe, expect, it } from 'vitest';

import { EMPTY_CUSTOMER, isCustomerComplete, validateCustomer } from '@/features/booking';

const VALID = { fullName: 'Maria Peralta', phone: '+1 809 555 0199', email: '' };

describe('validateCustomer', () => {
  it('accepts a name and a phone, with no email', () => {
    expect(validateCustomer(VALID)).toEqual({});
    expect(isCustomerComplete(VALID)).toBe(true);
  });

  it('accepts an optional email when it is well formed', () => {
    expect(validateCustomer({ ...VALID, email: 'maria@example.com' })).toEqual({});
  });

  it('rejects an email only when one was actually typed', () => {
    expect(validateCustomer({ ...VALID, email: '   ' })).toEqual({});
    expect(validateCustomer({ ...VALID, email: 'maria@' }).email).toBeDefined();
  });

  it('requires a name', () => {
    expect(validateCustomer({ ...VALID, fullName: '  ' }).fullName).toBeDefined();
    expect(validateCustomer({ ...VALID, fullName: 'M' }).fullName?.code).toBe('name.tooShort');
  });

  it('requires something that resembles a phone number', () => {
    expect(validateCustomer({ ...VALID, phone: '' }).phone?.code).toBe('phone.required');
    expect(validateCustomer({ ...VALID, phone: 'call me' }).phone).toBeDefined();
    expect(validateCustomer({ ...VALID, phone: '12345' }).phone).toBeDefined();
  });

  it('accepts the shapes real people actually type', () => {
    for (const phone of [
      '809-555-0199',
      '(809) 555 0199',
      '+34 600 00 00 00',
      '8095550199',
      '+1 809.555.0199',
    ]) {
      expect(validateCustomer({ ...VALID, phone }).phone).toBeUndefined();
    }
  });

  it('reports an empty draft as incomplete', () => {
    expect(isCustomerComplete(EMPTY_CUSTOMER)).toBe(false);
  });
});
