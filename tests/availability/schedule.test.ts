import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WEEKLY_SCHEDULE,
  toSchedulePayload,
  validateWeeklySchedule,
  type ScheduleEntry,
} from '@/features/availability/schedule';

describe('validateWeeklySchedule', () => {
  it('accepts the default week', () => {
    expect(validateWeeklySchedule(DEFAULT_WEEKLY_SCHEDULE)).toEqual([]);
  });

  it('accepts a split shift on the same day', () => {
    const split: ScheduleEntry[] = [
      { weekday: 1, startTime: '09:00', endTime: '13:00' },
      { weekday: 1, startTime: '14:00', endTime: '18:00' },
    ];
    expect(validateWeeklySchedule(split)).toEqual([]);
  });

  it('treats touching windows as fine, not overlapping', () => {
    const touching: ScheduleEntry[] = [
      { weekday: 1, startTime: '09:00', endTime: '13:00' },
      { weekday: 1, startTime: '13:00', endTime: '18:00' },
    ];
    expect(validateWeeklySchedule(touching)).toEqual([]);
  });

  it('reports an overlap and points at the offending row', () => {
    const overlapping: ScheduleEntry[] = [
      { weekday: 1, startTime: '09:00', endTime: '14:00' },
      { weekday: 1, startTime: '13:00', endTime: '18:00' },
    ];
    const issues = validateWeeklySchedule(overlapping);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.index).toBe(1);
    expect(issues[0]?.message).toMatch(/Monday/);
  });

  it('does not confuse the same hours on different days', () => {
    const twoDays: ScheduleEntry[] = [
      { weekday: 1, startTime: '09:00', endTime: '18:00' },
      { weekday: 2, startTime: '09:00', endTime: '18:00' },
    ];
    expect(validateWeeklySchedule(twoDays)).toEqual([]);
  });

  it('rejects a window that does not move forward', () => {
    const backwards: ScheduleEntry[] = [{ weekday: 3, startTime: '18:00', endTime: '09:00' }];
    expect(validateWeeklySchedule(backwards)[0]?.message).toMatch(/after the start/);
  });

  it('rejects a malformed time without throwing', () => {
    const malformed = [{ weekday: 3, startTime: '9h', endTime: '18:00' }] as ScheduleEntry[];
    expect(validateWeeklySchedule(malformed)[0]?.message).toMatch(/HH:mm/);
  });
});

describe('toSchedulePayload', () => {
  it('sends only what the database function reads', () => {
    expect(toSchedulePayload([{ weekday: 1, startTime: '09:00', endTime: '18:00' }])).toEqual([
      { weekday: 1, startTime: '09:00', endTime: '18:00' },
    ]);
  });
});
