import { describe, expect, it } from 'vitest';

import {
  InvalidTimeValueError,
  addDays,
  formatClockTime,
  isDateWithin,
  isoDateIn,
  parseClockTime,
  weekdayOf,
  zonedInstant,
} from '@/features/availability/time';

const SDQ = 'America/Santo_Domingo';
const NYC = 'America/New_York';

describe('parseClockTime', () => {
  it('accepts HH:mm and the Postgres HH:mm:ss form', () => {
    expect(parseClockTime('09:30')).toBe(570);
    expect(parseClockTime('09:30:00')).toBe(570);
  });

  it('accepts 24:00 as end-of-day', () => {
    expect(parseClockTime('24:00')).toBe(1440);
  });

  it('rejects malformed and out-of-range values', () => {
    expect(() => parseClockTime('9h30')).toThrow(InvalidTimeValueError);
    expect(() => parseClockTime('24:01')).toThrow(InvalidTimeValueError);
    expect(() => parseClockTime('10:75')).toThrow(InvalidTimeValueError);
  });
});

describe('formatClockTime', () => {
  it('round-trips with parseClockTime', () => {
    expect(formatClockTime(parseClockTime('07:05'))).toBe('07:05');
  });
});

describe('zonedInstant', () => {
  it('resolves wall-clock time in the business timezone to a UTC instant', () => {
    expect(zonedInstant('2026-09-21', parseClockTime('09:00'), SDQ).toISOString()).toBe(
      '2026-09-21T13:00:00.000Z',
    );
  });

  it('rolls 24:00 into the next day', () => {
    expect(zonedInstant('2026-09-21', 1440, SDQ).toISOString()).toBe('2026-09-22T04:00:00.000Z');
  });

  it('tracks daylight saving changes', () => {
    // 2026-03-08 is the US spring-forward date: 09:00 is EDT (-04:00),
    // while the same wall clock a day earlier is EST (-05:00).
    expect(zonedInstant('2026-03-07', 540, NYC).toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(zonedInstant('2026-03-08', 540, NYC).toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });
});

describe('weekdayOf', () => {
  it('reports the weekday as seen from the business timezone', () => {
    expect(weekdayOf('2026-09-21', SDQ)).toBe(1); // Monday
    expect(weekdayOf('2026-09-20', SDQ)).toBe(0); // Sunday
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('isoDateIn', () => {
  it('uses the business timezone, not the host timezone', () => {
    // 03:00 UTC is still the previous evening in Santo Domingo.
    expect(isoDateIn(new Date('2026-09-22T03:00:00.000Z'), SDQ)).toBe('2026-09-21');
  });
});

describe('isDateWithin', () => {
  it('treats both bounds as inclusive and null as unbounded', () => {
    expect(isDateWithin('2026-09-21', '2026-09-21', '2026-09-21')).toBe(true);
    expect(isDateWithin('2026-09-21', '2026-09-22', null)).toBe(false);
    expect(isDateWithin('2026-09-21', null, '2026-09-20')).toBe(false);
    expect(isDateWithin('2026-09-21', null, null)).toBe(true);
  });
});
