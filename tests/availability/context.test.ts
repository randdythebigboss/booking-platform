import { describe, expect, it } from 'vitest';

import {
  MalformedAvailabilityContextError,
  parseAvailabilityContext,
  slotsForDate,
} from '@/features/availability';

const RAW = {
  timezone: 'America/Santo_Domingo',
  policy: { slotIntervalMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 60 },
  service: {
    id: 'svc-1',
    name: 'Haircut',
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 5,
    // PostgREST renders numeric(10,2) as a string.
    price: '800.00',
    currency: 'DOP',
  },
  rules: [
    {
      weekday: 1,
      startTime: '09:00',
      endTime: '11:00',
      effectiveFrom: null,
      effectiveUntil: null,
    },
  ],
  exceptions: [{ date: '2026-09-21', type: 'unavailable', startTime: '10:00', endTime: '10:30' }],
  busy: [{ startsAt: '2026-09-21T13:00:00+00:00', endsAt: '2026-09-21T13:30:00+00:00' }],
};

describe('parseAvailabilityContext', () => {
  it('reads the payload the database function produces', () => {
    const context = parseAvailabilityContext(RAW);

    expect(context.timezone).toBe('America/Santo_Domingo');
    expect(context.policy.slotIntervalMinutes).toBe(30);
    expect(context.service.price).toBe(800);
    expect(context.rules).toHaveLength(1);
    expect(context.exceptions[0]?.type).toBe('unavailable');
    expect(context.busy[0]?.startsAt.toISOString()).toBe('2026-09-21T13:00:00.000Z');
  });

  it('keeps null effective dates as null rather than undefined', () => {
    expect(parseAvailabilityContext(RAW).rules[0]?.effectiveFrom).toBeNull();
  });

  it('names the field it could not read', () => {
    const broken = { ...RAW, busy: [{ startsAt: 'not-a-date', endsAt: 'also-not' }] };
    expect(() => parseAvailabilityContext(broken)).toThrow(MalformedAvailabilityContextError);
    expect(() => parseAvailabilityContext(broken)).toThrow(/busy\[0\]\.startsAt/);
  });

  it('rejects a payload that is not an object', () => {
    expect(() => parseAvailabilityContext(null)).toThrow(MalformedAvailabilityContextError);
    expect(() => parseAvailabilityContext([])).toThrow(MalformedAvailabilityContextError);
  });

  it('rejects a missing policy', () => {
    const { policy: _policy, ...rest } = RAW;
    expect(() => parseAvailabilityContext(rest)).toThrow(/policy/);
  });
});

describe('slotsForDate', () => {
  it('runs the engine over a parsed context', () => {
    const context = parseAvailabilityContext(RAW);
    const slots = slotsForDate(context, '2026-09-21', new Date('2026-09-01T00:00:00.000Z'));

    // 09:00-11:00 local, 30-minute service with a 5-minute trailing buffer,
    // minus the 10:00-10:30 exception and the 09:00-09:30 UTC busy period.
    expect(slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      '2026-09-21T13:30:00.000Z',
      '2026-09-21T14:30:00.000Z',
    ]);
  });
});
