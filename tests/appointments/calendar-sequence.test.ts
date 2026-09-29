import { describe, expect, it } from 'vitest';

import { buildAppointmentIcs, calendarSequence } from '@/features/appointments';

/**
 * The part of a calendar file that decides whether a second download replaces
 * the first one or is ignored.
 *
 * ---------------------------------------------------------------------------
 * Why this matters more than it looks
 * ---------------------------------------------------------------------------
 *
 * A stable UID stops a re-import creating a duplicate. It does not make the
 * re-import win: a calendar that already holds UID X at SEQUENCE 0 is entitled
 * to ignore another copy of UID X at SEQUENCE 0. So an appointment that moved
 * would download cleanly, import silently, and leave the person looking at the
 * old time -- which is the worst of the three possible outcomes, because
 * nothing appears to have gone wrong.
 */
describe('the calendar sequence', () => {
  it('is zero when nothing says when the appointment last changed', () => {
    // An older project that has not had the migration returns no updatedAt.
    // Zero is the same behaviour the file had before, not a crash.
    expect(calendarSequence(null)).toBe(0);
    expect(calendarSequence(undefined)).toBe(0);
    expect(calendarSequence(new Date('not a date'))).toBe(0);
  });

  it('increases when the appointment does', () => {
    const first = calendarSequence(new Date('2026-10-01T10:00:00Z'));
    const second = calendarSequence(new Date('2026-10-01T10:05:00Z'));
    const later = calendarSequence(new Date('2026-11-01T10:00:00Z'));

    expect(second).toBeGreaterThan(first);
    expect(later).toBeGreaterThan(second);
  });

  it('never goes negative for a row older than the epoch it counts from', () => {
    expect(calendarSequence(new Date('2020-01-01T00:00:00Z'))).toBe(0);
  });

  it('stays a number a calendar will accept, not one that overflows', () => {
    // Raw epoch seconds would pass 2^31 in 2038. Minutes since 2026 will not
    // reach it for four thousand years.
    const far = calendarSequence(new Date('2126-01-01T00:00:00Z'));
    expect(far).toBeLessThan(2 ** 31 - 1);
    expect(Number.isInteger(far)).toBe(true);
  });

  it('lands in the file where a calendar looks for it', () => {
    const ics = buildAppointmentIcs({
      appointmentId: '11111111-1111-4111-8111-111111111111',
      startsAt: new Date('2026-10-05T13:00:00Z'),
      endsAt: new Date('2026-10-05T13:30:00Z'),
      serviceName: 'Corte de cabello',
      businessName: 'Estudio Demo',
      status: 'confirmed',
      sequence: calendarSequence(new Date('2026-10-01T10:00:00Z')),
      now: new Date('2026-10-01T10:00:00Z'),
    });

    expect(ics).toContain('UID:11111111-1111-4111-8111-111111111111@booking-platform');
    expect(ics).toMatch(/SEQUENCE:\d+/);
    expect(ics).not.toContain('SEQUENCE:0\r\n');
  });
});

describe('what a rescheduled or cancelled appointment produces', () => {
  const common = {
    appointmentId: '22222222-2222-4222-8222-222222222222',
    serviceName: 'Corte + barba',
    businessName: 'Estudio Demo',
    now: new Date('2026-10-01T10:00:00Z'),
  };

  it('keeps one identity across a move, so the calendar updates instead of duplicating', () => {
    const before = buildAppointmentIcs({
      ...common,
      startsAt: new Date('2026-10-05T13:00:00Z'),
      endsAt: new Date('2026-10-05T13:45:00Z'),
      status: 'confirmed',
      sequence: calendarSequence(new Date('2026-10-01T10:00:00Z')),
    });

    const after = buildAppointmentIcs({
      ...common,
      startsAt: new Date('2026-10-06T15:00:00Z'),
      endsAt: new Date('2026-10-06T15:45:00Z'),
      status: 'confirmed',
      sequence: calendarSequence(new Date('2026-10-02T09:00:00Z')),
    });

    const uid = (ics: string) => /UID:(.+)/.exec(ics)?.[1];
    const sequence = (ics: string) => Number(/SEQUENCE:(\d+)/.exec(ics)?.[1]);
    const start = (ics: string) => /DTSTART:(.+)/.exec(ics)?.[1];

    expect(uid(after)).toBe(uid(before));
    expect(sequence(after)).toBeGreaterThan(sequence(before));
    expect(start(after)).not.toBe(start(before));
  });

  it('withdraws the event rather than adding a silent second one', () => {
    const cancelled = buildAppointmentIcs({
      ...common,
      startsAt: new Date('2026-10-05T13:00:00Z'),
      endsAt: new Date('2026-10-05T13:45:00Z'),
      status: 'cancelled',
      reminderMinutes: 30,
      sequence: calendarSequence(new Date('2026-10-03T08:00:00Z')),
    });

    expect(cancelled).toContain('METHOD:CANCEL');
    expect(cancelled).toContain('STATUS:CANCELLED');
    // An alarm on a withdrawal would ring for an appointment that is not
    // happening. The builder drops it; this is what says so out loud.
    expect(cancelled).not.toContain('BEGIN:VALARM');
  });

  it('asks for the alarm the person chose, in the form iCalendar defines', () => {
    for (const minutes of [15, 30]) {
      const ics = buildAppointmentIcs({
        ...common,
        startsAt: new Date('2026-10-05T13:00:00Z'),
        endsAt: new Date('2026-10-05T13:45:00Z'),
        status: 'confirmed',
        reminderMinutes: minutes,
      });

      expect(ics).toContain('BEGIN:VALARM');
      expect(ics).toContain(`TRIGGER:-PT${minutes}M`);
      expect(ics).toContain('ACTION:DISPLAY');
    }
  });

  it('writes the times as absolute instants, so no reader has to guess a zone', () => {
    const ics = buildAppointmentIcs({
      ...common,
      // 13:00 UTC is 09:00 in Santo Domingo. The file must say the instant,
      // not the local clock reading, or an importer in another country moves
      // the appointment by four hours.
      startsAt: new Date('2026-10-05T13:00:00Z'),
      endsAt: new Date('2026-10-05T13:45:00Z'),
      status: 'confirmed',
    });

    expect(ics).toContain('DTSTART:20261005T130000Z');
    expect(ics).toContain('DTEND:20261005T134500Z');
  });
});
