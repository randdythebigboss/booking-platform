import { describe, expect, it } from 'vitest';

import {
  InvalidAvailabilityInputError,
  computeAvailableSlots,
  resolveWorkingWindows,
} from '@/features/availability';
import type {
  BusyPeriod,
  ComputeSlotsInput,
  ServiceTiming,
  Slot,
  WeeklyRule,
} from '@/features/availability';

const SDQ = 'America/Santo_Domingo';
const NYC = 'America/New_York';

/** A Monday. */
const MONDAY = '2026-09-21';
/** Well before any date under test, so minimum notice never interferes. */
const LONG_AGO = new Date('2026-09-01T00:00:00.000Z');

const NINE_TO_FIVE: WeeklyRule[] = [{ weekday: 1, startTime: '09:00', endTime: '17:00' }];

const SERVICE_45: ServiceTiming = {
  durationMinutes: 45,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
};

/** Santo Domingo is UTC-4 year round, which keeps these fixtures readable. */
function at(time: string, date = MONDAY): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const utcHours = String((hours ?? 0) + 4).padStart(2, '0');
  const utcMinutes = String(minutes ?? 0).padStart(2, '0');
  return new Date(date + 'T' + utcHours + ':' + utcMinutes + ':00.000Z');
}

function busy(start: string, end: string): BusyPeriod {
  return { startsAt: at(start), endsAt: at(end) };
}

function localTimes(slots: Slot[], timezone = SDQ): string[] {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return slots.map((slot) => formatter.format(slot.startsAt));
}

function input(overrides: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  return {
    date: MONDAY,
    timezone: SDQ,
    service: SERVICE_45,
    rules: NINE_TO_FIVE,
    now: LONG_AGO,
    policy: { slotIntervalMinutes: 15, minimumNoticeMinutes: 0, bookingHorizonDays: 60 },
    ...overrides,
  };
}

describe('computeAvailableSlots - the blueprint scenario', () => {
  // Shift 09:00-17:00, an existing 10:00-10:30 appointment, a 13:00-14:00
  // block, and a 45-minute service.
  const slots = computeAvailableSlots(
    input({ busy: [busy('10:00', '10:30'), busy('13:00', '14:00')] }),
  );
  const times = localTimes(slots);

  it('offers only start times where the full 45 minutes fit', () => {
    expect(times).toContain('09:00');
    expect(times).toContain('09:15');
    // 09:45 + 45min would run into the 10:00 appointment.
    expect(times).not.toContain('09:45');
    expect(times).toContain('10:30');
  });

  it('never offers a start time that runs into the block', () => {
    expect(times).not.toContain('12:30');
    expect(times).not.toContain('13:00');
    expect(times).toContain('14:00');
  });

  it('stops early enough for the service to finish before closing', () => {
    expect(times).toContain('16:15');
    expect(times).not.toContain('16:30');
    expect(slots[slots.length - 1]?.endsAt.toISOString()).toBe('2026-09-21T21:00:00.000Z');
  });

  it('returns slots in chronological order', () => {
    const starts = slots.map((slot) => slot.startsAt.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe('computeAvailableSlots - schedule resolution', () => {
  it('returns nothing on a day with no matching rule', () => {
    expect(computeAvailableSlots(input({ date: '2026-09-20' }))).toEqual([]);
  });

  it('honours the effective range of a rule', () => {
    const expired: WeeklyRule[] = [
      { weekday: 1, startTime: '09:00', endTime: '17:00', effectiveUntil: '2026-09-20' },
    ];
    expect(computeAvailableSlots(input({ rules: expired }))).toEqual([]);
  });

  it('closes the whole day for an untimed unavailable exception', () => {
    expect(
      computeAvailableSlots(input({ exceptions: [{ date: MONDAY, type: 'unavailable' }] })),
    ).toEqual([]);
  });

  it('subtracts a timed unavailable exception', () => {
    const times = localTimes(
      computeAvailableSlots(
        input({
          exceptions: [{ date: MONDAY, type: 'unavailable', startTime: '12:00', endTime: '15:00' }],
        }),
      ),
    );
    expect(times).not.toContain('12:00');
    expect(times).not.toContain('14:00');
    expect(times).toContain('11:00');
    expect(times).toContain('15:00');
  });

  it('lets an available exception replace the weekly rule', () => {
    const times = localTimes(
      computeAvailableSlots(
        input({
          exceptions: [{ date: MONDAY, type: 'available', startTime: '19:00', endTime: '20:00' }],
        }),
      ),
    );
    expect(times).toEqual(['19:00', '19:15']);
  });

  it('ignores exceptions belonging to another date', () => {
    const slots = computeAvailableSlots(
      input({ exceptions: [{ date: '2026-09-22', type: 'unavailable' }] }),
    );
    expect(slots.length).toBeGreaterThan(0);
  });

  it('drops a window whose end is not after its start', () => {
    expect(
      resolveWorkingWindows(
        MONDAY,
        SDQ,
        [{ weekday: 1, startTime: '17:00', endTime: '09:00' }],
        [],
      ),
    ).toEqual([]);
  });
});

describe('computeAvailableSlots - buffers', () => {
  it('keeps buffer time clear of busy periods', () => {
    const times = localTimes(
      computeAvailableSlots(
        input({
          service: { durationMinutes: 45, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 },
          busy: [busy('10:00', '10:30')],
        }),
      ),
    );
    // Without buffers 10:30 would be bookable; the 15-minute lead-in overlaps.
    expect(times).not.toContain('10:30');
    expect(times).toContain('10:45');
    // The trailing buffer pushes the pre-appointment starts earlier too.
    expect(times).not.toContain('09:15');
  });

  it('allows buffers to spill outside working hours', () => {
    const times = localTimes(
      computeAvailableSlots(
        input({ service: { durationMinutes: 45, bufferBeforeMinutes: 30, bufferAfterMinutes: 0 } }),
      ),
    );
    // The service still starts at 09:00 even though its buffer starts at 08:30.
    expect(times[0]).toBe('09:00');
  });
});

describe('computeAvailableSlots - booking policy', () => {
  it('drops slots inside the minimum notice period', () => {
    const times = localTimes(
      computeAvailableSlots(
        input({
          now: at('09:00'),
          policy: { slotIntervalMinutes: 15, minimumNoticeMinutes: 120, bookingHorizonDays: 60 },
        }),
      ),
    );
    expect(times[0]).toBe('11:00');
  });

  it('refuses dates beyond the booking horizon', () => {
    expect(
      computeAvailableSlots(
        input({
          now: at('09:00'),
          date: '2026-09-28',
          policy: { slotIntervalMinutes: 15, minimumNoticeMinutes: 0, bookingHorizonDays: 3 },
        }),
      ),
    ).toEqual([]);
  });

  it('refuses dates in the past', () => {
    expect(computeAvailableSlots(input({ now: new Date('2026-09-28T12:00:00.000Z') }))).toEqual([]);
  });

  it('follows the slot interval', () => {
    const times = localTimes(
      computeAvailableSlots(
        input({
          policy: { slotIntervalMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 60 },
        }),
      ),
    );
    expect(times).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
  });

  it('aligns candidate starts to the shift, not to the clock hour', () => {
    const times = localTimes(
      computeAvailableSlots(
        input({ rules: [{ weekday: 1, startTime: '09:10', endTime: '11:00' }] }),
      ),
    );
    expect(times[0]).toBe('09:10');
    expect(times[1]).toBe('09:25');
  });

  it('returns nothing when the service is longer than the window', () => {
    expect(
      computeAvailableSlots(
        input({ rules: [{ weekday: 1, startTime: '09:00', endTime: '09:30' }] }),
      ),
    ).toEqual([]);
  });
});

describe('computeAvailableSlots - timezones', () => {
  it('measures a shift in real elapsed time across a DST transition', () => {
    // 2026-03-08 in New York: 02:00 never happens, so 00:00-06:00 is 5 hours.
    const windows = resolveWorkingWindows(
      '2026-03-08',
      NYC,
      [{ weekday: 0, startTime: '00:00', endTime: '06:00' }],
      [],
    );
    expect(windows).toHaveLength(1);
    expect((windows[0]!.end - windows[0]!.start) / 3_600_000).toBe(5);
  });

  it('anchors slots to the business timezone, not the host clock', () => {
    const slots = computeAvailableSlots(
      input({
        timezone: NYC,
        policy: { slotIntervalMinutes: 480, minimumNoticeMinutes: 0, bookingHorizonDays: 60 },
      }),
    );
    // 09:00 in New York on 2026-09-21 is 13:00 UTC (EDT, -04:00).
    expect(slots[0]?.startsAt.toISOString()).toBe('2026-09-21T13:00:00.000Z');
  });
});

describe('computeAvailableSlots - input validation', () => {
  it('rejects a non-positive duration', () => {
    expect(() =>
      computeAvailableSlots(
        input({ service: { durationMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } }),
      ),
    ).toThrow(InvalidAvailabilityInputError);
  });

  it('rejects negative buffers', () => {
    expect(() =>
      computeAvailableSlots(
        input({ service: { durationMinutes: 30, bufferBeforeMinutes: -5, bufferAfterMinutes: 0 } }),
      ),
    ).toThrow(InvalidAvailabilityInputError);
  });

  it('rejects a non-positive slot interval', () => {
    expect(() =>
      computeAvailableSlots(
        input({
          policy: { slotIntervalMinutes: 0, minimumNoticeMinutes: 0, bookingHorizonDays: 60 },
        }),
      ),
    ).toThrow(InvalidAvailabilityInputError);
  });
});
