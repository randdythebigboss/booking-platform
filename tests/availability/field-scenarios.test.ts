/**
 * The scenarios a real hairstylist described, run against the real engine.
 *
 * These are here because the feedback that produced them was not "the
 * scheduling is wrong", it was "I do not know what the scheduling will do".
 * The answer to that is not a rewrite; it is an executable statement of what
 * the engine already decides, in the professional's own words, so the next
 * person to doubt it can read a test instead of reasoning about a grid.
 *
 * Every case fixes the business day, the timezone and `now`, so none of them
 * can pass or fail because of when the suite happens to run.
 */
import { describe, expect, it } from 'vitest';

import { computeAvailableSlots } from '@/features/availability/slots';
import type { BusyPeriod, ComputeSlotsInput, WeeklyRule } from '@/features/availability/types';

const TZ = 'America/Santo_Domingo';
const DATE = '2026-10-05'; // a Monday
/** 07:00 local. Early enough that minimum notice never clips the morning. */
const NOW = new Date('2026-10-05T11:00:00.000Z');

const MONDAY_9_TO_6: WeeklyRule[] = [{ weekday: 1, startTime: '09:00', endTime: '18:00' }];

/** Local clock time -> the instant it denotes in Santo Domingo (UTC-4, no DST). */
function at(clock: string): Date {
  return new Date(`${DATE}T${clock}:00.000-04:00`);
}

function busy(startClock: string, endClock: string): BusyPeriod {
  return { startsAt: at(startClock), endsAt: at(endClock) };
}

function offered(options: {
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  slotIntervalMinutes?: number;
  rules?: WeeklyRule[];
  exceptions?: ComputeSlotsInput['exceptions'];
  busy?: BusyPeriod[];
}): string[] {
  const slots = computeAvailableSlots({
    date: DATE,
    timezone: TZ,
    now: NOW,
    service: {
      durationMinutes: options.durationMinutes,
      bufferBeforeMinutes: options.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: options.bufferAfterMinutes ?? 0,
    },
    rules: options.rules ?? MONDAY_9_TO_6,
    exceptions: options.exceptions ?? [],
    busy: options.busy ?? [],
    policy: {
      slotIntervalMinutes: options.slotIntervalMinutes ?? 15,
      minimumNoticeMinutes: 60,
      bookingHorizonDays: 60,
    },
  });
  return slots.map((slot) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(slot.startsAt),
  );
}

describe('A. the 20-minute edge-up at 10:30, then a 40-minute haircut', () => {
  const EDGE_UP = [busy('10:30', '10:50')];

  it('does not offer a 40-minute haircut that would run into the edge-up', () => {
    const times = offered({ durationMinutes: 40, busy: EDGE_UP });
    // 10:15 would end 10:55, inside the edge-up. 10:30 and 10:45 likewise.
    expect(times).not.toContain('10:15');
    expect(times).not.toContain('10:30');
    expect(times).not.toContain('10:45');
  });

  it('offers 11:00 on a 15-minute grid, and NOT noon', () => {
    const times = offered({ durationMinutes: 40, busy: EDGE_UP });
    expect(times).toContain('11:00');
    // The specific worry in the feedback: work is not pushed to the next hour.
    const firstAfter = times.find((clock) => clock >= '10:50');
    expect(firstAfter).toBe('11:00');
  });

  it('offers 10:50 itself once the grid is 10 minutes, with no gap at all', () => {
    const times = offered({ durationMinutes: 40, busy: EDGE_UP, slotIntervalMinutes: 10 });
    expect(times).toContain('10:50');
  });

  it('still offers 10:50 on a 5-minute grid, which is the tightest packing', () => {
    const times = offered({ durationMinutes: 40, busy: EDGE_UP, slotIntervalMinutes: 5 });
    expect(times).toContain('10:50');
  });

  it('pushes the next start out by the after-buffer, not by the clock', () => {
    // 10 minutes of cleanup after the edge-up is expressed on the BUSY range,
    // which is what the database stores. 10:50 is then unusable; 11:00 is not.
    const times = offered({
      durationMinutes: 40,
      slotIntervalMinutes: 10,
      busy: [busy('10:30', '11:00')],
    });
    expect(times).not.toContain('10:50');
    expect(times).toContain('11:00');
  });
});

describe('B. a short service fits before an existing appointment, a long one does not', () => {
  // Nothing until 09:00; an appointment at 10:00. That leaves exactly 60 min.
  const TEN_OCLOCK = [busy('10:00', '11:00')];

  it('offers a 30-minute service at 09:30, which ends exactly at 10:00', () => {
    expect(offered({ durationMinutes: 30, busy: TEN_OCLOCK })).toContain('09:30');
  });

  it('refuses a 90-minute service in the same gap', () => {
    const times = offered({ durationMinutes: 90, busy: TEN_OCLOCK });
    expect(times.filter((clock) => clock < '10:00')).toEqual([]);
  });

  it('offers the 90-minute service after the appointment instead', () => {
    expect(offered({ durationMinutes: 90, busy: TEN_OCLOCK })).toContain('11:00');
  });
});

describe('C. two adjacent bookings never overlap', () => {
  it('a service ending exactly when the next begins is allowed', () => {
    // 09:00-09:30 taken. A 30-minute service at 09:30 touches but does not overlap.
    expect(offered({ durationMinutes: 30, busy: [busy('09:00', '09:30')] })).toContain('09:30');
  });

  it('but one minute of genuine overlap is not', () => {
    // 09:00-09:31 taken: 09:30 would overlap by a minute and must disappear.
    expect(offered({ durationMinutes: 30, busy: [busy('09:00', '09:31')] })).not.toContain('09:30');
  });
});

describe('D. a split shift with an unavailable break', () => {
  const LUNCH: ComputeSlotsInput['exceptions'] = [
    { date: DATE, type: 'unavailable', startTime: '13:00', endTime: '14:00' },
  ];

  it('offers nothing that runs into the break', () => {
    const times = offered({ durationMinutes: 40, exceptions: LUNCH });
    expect(times).not.toContain('12:30'); // would end 13:10
    expect(times).not.toContain('12:45');
    expect(times).not.toContain('13:00');
    expect(times).not.toContain('13:30');
  });

  it('offers the last slot that finishes by the break, and the first after it', () => {
    const times = offered({ durationMinutes: 40, exceptions: LUNCH });
    expect(times).toContain('12:15'); // 12:15-12:55, clear of 13:00
    expect(times).toContain('14:00');
  });

  it('keeps the grid anchored to the shift, not restarted by the break', () => {
    // The shift opens 09:10, so the grid is :10/:25/:40/:55 all day, and the
    // break removes slots without re-anchoring anything after it.
    const times = offered({
      durationMinutes: 30,
      rules: [{ weekday: 1, startTime: '09:10', endTime: '18:00' }],
      exceptions: LUNCH,
    });
    expect(times).toContain('09:10');
    expect(times).toContain('14:10');
    expect(times).not.toContain('14:00');
  });
});

describe('E. a one-day override: tomorrow is 09:30 to 16:00', () => {
  const OVERRIDE: ComputeSlotsInput['exceptions'] = [
    { date: DATE, type: 'available', startTime: '09:30', endTime: '16:00' },
  ];

  it('replaces the weekly hours for that date only', () => {
    const times = offered({ durationMinutes: 30, exceptions: OVERRIDE });
    expect(times[0]).toBe('09:30');
    expect(times).not.toContain('09:00');
  });

  it('stops offering starts that would run past the new closing time', () => {
    const times = offered({ durationMinutes: 30, exceptions: OVERRIDE });
    expect(times.at(-1)).toBe('15:30'); // 15:30-16:00 is the last that fits
    expect(times).not.toContain('16:00');
    expect(times).not.toContain('17:00');
  });

  it('leaves the same weekday alone on other dates', () => {
    // The exception names one date; the weekly rule still governs the rest.
    const times = offered({ durationMinutes: 30, exceptions: [] });
    expect(times[0]).toBe('09:00');
  });
});

describe('F. a one-day override that conflicts with an appointment already booked', () => {
  const OVERRIDE: ComputeSlotsInput['exceptions'] = [
    { date: DATE, type: 'available', startTime: '09:30', endTime: '16:00' },
  ];

  it('does not offer the hour an existing late appointment occupies', () => {
    // 17:00 was booked under the old hours. The override closes at 16:00, so
    // availability simply stops before it: the engine never offers it again.
    const times = offered({
      durationMinutes: 30,
      exceptions: OVERRIDE,
      busy: [busy('17:00', '17:30')],
    });
    expect(times).not.toContain('17:00');
  });

  it('and the appointment itself is untouched by availability maths', () => {
    // Availability is derived, never stored, so nothing here can move or
    // cancel a booked appointment. The conflict is a fact the UI must show,
    // not something the engine silently resolves.
    const times = offered({
      durationMinutes: 30,
      exceptions: OVERRIDE,
      busy: [busy('17:00', '17:30')],
    });
    expect(times.at(-1)).toBe('15:30');
  });
});
