import { describe, expect, it } from 'vitest';

import { parseNumericInput, validateService } from '@/features/services/validation';

const VALID = {
  name: 'Haircut',
  durationMinutes: 30,
  price: 800,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 5,
};

describe('validateService', () => {
  it('accepts a well-formed service', () => {
    expect(validateService(VALID)).toEqual({});
  });

  it('requires a name', () => {
    expect(validateService({ ...VALID, name: '   ' }).name).toBeDefined();
  });

  it('requires a positive whole duration', () => {
    expect(validateService({ ...VALID, durationMinutes: 0 }).durationMinutes).toBeDefined();
    expect(validateService({ ...VALID, durationMinutes: 12.5 }).durationMinutes).toBeDefined();
    expect(
      validateService({ ...VALID, durationMinutes: Number.NaN }).durationMinutes,
    ).toBeDefined();
  });

  it('refuses a service longer than a day, as the database does', () => {
    expect(validateService({ ...VALID, durationMinutes: 1441 }).durationMinutes).toBeDefined();
    expect(validateService({ ...VALID, durationMinutes: 1440 }).durationMinutes).toBeUndefined();
  });

  it('allows a free service but not a negative one', () => {
    expect(validateService({ ...VALID, price: 0 }).price).toBeUndefined();
    expect(validateService({ ...VALID, price: -1 }).price).toBeDefined();
  });

  it('rejects negative buffers', () => {
    expect(
      validateService({ ...VALID, bufferBeforeMinutes: -5 }).bufferBeforeMinutes,
    ).toBeDefined();
  });
});

describe('parseNumericInput', () => {
  it('does not turn an empty field into zero', () => {
    expect(parseNumericInput('')).toBeNaN();
    expect(parseNumericInput('   ')).toBeNaN();
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parseNumericInput('1200,50')).toBe(1200.5);
  });

  it('reads a plain number', () => {
    expect(parseNumericInput(' 45 ')).toBe(45);
  });
});
