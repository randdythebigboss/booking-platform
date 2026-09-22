import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_ACTOR_TYPES,
  APPOINTMENT_EVENT_TYPES,
  actorLabel,
  describeEvent,
  rescheduleCount,
  sortEvents,
  type AppointmentEvent,
} from '@/features/appointments';

const AT = (iso: string) => new Date(iso);

function event(partial: Partial<AppointmentEvent> & Pick<AppointmentEvent, 'type'>) {
  return {
    id: partial.id ?? 'event-1',
    actor: partial.actor ?? 'professional',
    occurredAt: partial.occurredAt ?? AT('2026-09-22T12:00:00.000Z'),
    previousStatus: partial.previousStatus ?? null,
    newStatus: partial.newStatus ?? null,
    previousStartsAt: partial.previousStartsAt ?? null,
    newStartsAt: partial.newStartsAt ?? null,
    reason: partial.reason ?? null,
    type: partial.type,
  } satisfies AppointmentEvent;
}

/** A formatter with no timezone database in it, so these stay pure. */
const clock = (at: Date) => at.toISOString().slice(11, 16);

describe('actorLabel', () => {
  it('speaks to the professional reading the screen', () => {
    expect(actorLabel('professional')).toBe('You');
    expect(actorLabel('guest')).toBe('The customer');
  });

  it('does not reassure about an unattributed change', () => {
    expect(actorLabel('system')).toBe('The system');
  });

  it('covers every actor the database can produce', () => {
    for (const actor of APPOINTMENT_ACTOR_TYPES) {
      expect(actorLabel(actor).length).toBeGreaterThan(0);
    }
  });
});

describe('describeEvent', () => {
  it('names who booked it', () => {
    expect(describeEvent(event({ type: 'created', actor: 'guest' }), clock)).toBe(
      'The customer booked this appointment',
    );
  });

  it('says where a move came from and where it went', () => {
    const line = describeEvent(
      event({
        type: 'rescheduled',
        actor: 'guest',
        previousStartsAt: AT('2026-09-23T14:00:00.000Z'),
        newStartsAt: AT('2026-09-24T17:30:00.000Z'),
      }),
      clock,
    );
    expect(line).toBe('The customer moved it from 14:00 to 17:30');
  });

  it('reads a cancellation as a cancellation, not as a status', () => {
    expect(
      describeEvent(
        event({
          type: 'status_changed',
          previousStatus: 'confirmed',
          newStatus: 'cancelled',
        }),
        clock,
      ),
    ).toBe('You cancelled it');
  });

  it('uses the human label for every other status', () => {
    expect(
      describeEvent(event({ type: 'status_changed', newStatus: 'no_show' }), clock),
    ).toBe('You marked it no-show');
    expect(
      describeEvent(event({ type: 'status_changed', newStatus: 'completed' }), clock),
    ).toBe('You marked it completed');
  });

  it('never produces an empty line, whatever the event', () => {
    for (const type of APPOINTMENT_EVENT_TYPES) {
      expect(describeEvent(event({ type }), clock).length).toBeGreaterThan(0);
    }
  });

  it('survives a reschedule event that lost one of its endpoints', () => {
    const line = describeEvent(
      event({ type: 'rescheduled', newStartsAt: AT('2026-09-24T17:30:00.000Z') }),
      clock,
    );
    expect(line).toContain('an earlier time');
    expect(line).toContain('17:30');
  });
});

describe('sortEvents', () => {
  it('reads oldest first, so history is a story', () => {
    const later = event({ id: 'b', type: 'rescheduled', occurredAt: AT('2026-09-22T12:00:02Z') });
    const earlier = event({ id: 'a', type: 'created', occurredAt: AT('2026-09-22T12:00:01Z') });

    expect(sortEvents([later, earlier]).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('leaves the array it was given alone', () => {
    const input = [
      event({ id: 'b', type: 'rescheduled', occurredAt: AT('2026-09-22T12:00:02Z') }),
      event({ id: 'a', type: 'created', occurredAt: AT('2026-09-22T12:00:01Z') }),
    ];
    sortEvents(input);
    expect(input.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('rescheduleCount', () => {
  it('counts only moves', () => {
    const events = [
      event({ id: '1', type: 'created' }),
      event({ id: '2', type: 'rescheduled' }),
      event({ id: '3', type: 'status_changed', newStatus: 'confirmed' }),
      event({ id: '4', type: 'rescheduled' }),
    ];
    expect(rescheduleCount(events)).toBe(2);
  });

  it('is zero for an appointment that never moved', () => {
    expect(rescheduleCount([event({ id: '1', type: 'created' })])).toBe(0);
  });
});
