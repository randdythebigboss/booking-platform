import { describe, expect, it } from 'vitest';

import {
  describeException,
  toBlockRange,
  validateBlock,
  validateException,
  type BlockDraft,
  type ExceptionDraft,
} from '@/features/availability';

const SDQ = 'America/Santo_Domingo';
const NYC = 'America/New_York';

const BLOCK: BlockDraft = { date: '2026-09-28', startTime: '12:00', endTime: '14:30' };

describe('validateBlock', () => {
  it('accepts a well-formed partial block', () => {
    expect(validateBlock(BLOCK)).toEqual({});
  });

  it('requires a date', () => {
    expect(validateBlock({ ...BLOCK, date: '' }).date).toBeDefined();
    expect(validateBlock({ ...BLOCK, date: '28/09/2026' }).date).toBeDefined();
  });

  it('rejects times it cannot read', () => {
    expect(validateBlock({ ...BLOCK, startTime: 'noon' }).startTime).toMatch(/HH:mm/);
    expect(validateBlock({ ...BLOCK, endTime: '25:00' }).endTime).toMatch(/HH:mm/);
  });

  it('requires the block to move forward', () => {
    expect(validateBlock({ ...BLOCK, startTime: '14:00', endTime: '14:00' }).endTime).toMatch(
      /after the start/,
    );
    expect(validateBlock({ ...BLOCK, startTime: '15:00', endTime: '14:00' }).endTime).toMatch(
      /after the start/,
    );
  });
});

describe('toBlockRange', () => {
  it('resolves against the business timezone, not the device', () => {
    const range = toBlockRange(BLOCK, SDQ);
    expect(range.startsAt.toISOString()).toBe('2026-09-28T16:00:00.000Z');
    expect(range.endsAt.toISOString()).toBe('2026-09-28T18:30:00.000Z');
  });

  it('gives a different instant for the same wall clock in another zone', () => {
    const sdq = toBlockRange(BLOCK, SDQ).startsAt.getTime();
    const madrid = toBlockRange(BLOCK, 'Europe/Madrid').startsAt.getTime();
    expect(sdq).not.toBe(madrid);
  });

  it('follows a daylight saving change', () => {
    // 2026-03-08 is the US spring-forward date, so 09:00 is EDT not EST.
    const before = toBlockRange({ ...BLOCK, date: '2026-03-07', startTime: '09:00' }, NYC);
    const after = toBlockRange({ ...BLOCK, date: '2026-03-08', startTime: '09:00' }, NYC);
    expect(before.startsAt.toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(after.startsAt.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });
});

describe('validateException', () => {
  const closed: ExceptionDraft = { date: '2026-09-29', kind: 'closed' };
  const custom: ExceptionDraft = {
    date: '2026-09-29',
    kind: 'custom-hours',
    startTime: '12:00',
    endTime: '20:00',
  };

  it('accepts a closed day with no times', () => {
    expect(validateException(closed)).toEqual({});
  });

  it('accepts custom hours', () => {
    expect(validateException(custom)).toEqual({});
  });

  it('requires both times for custom hours', () => {
    const errors = validateException({ date: '2026-09-29', kind: 'custom-hours' });
    expect(errors.startTime).toBeDefined();
    expect(errors.endTime).toBeDefined();
  });

  it('requires custom hours to move forward', () => {
    expect(validateException({ ...custom, startTime: '20:00' }).endTime).toMatch(/after the/);
  });

  it('still checks the date for a closed day', () => {
    expect(validateException({ date: 'tuesday', kind: 'closed' }).date).toBeDefined();
  });
});

describe('describeException', () => {
  it('says plainly which of the two things it is', () => {
    expect(describeException({ date: '2026-09-29', kind: 'closed' })).toMatch(/Closed all day/);
    expect(
      describeException({
        date: '2026-09-29',
        kind: 'custom-hours',
        startTime: '12:00',
        endTime: '20:00',
      }),
    ).toMatch(/instead of the usual hours/);
  });
});
