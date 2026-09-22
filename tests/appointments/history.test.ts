import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_ACTOR_TYPES,
  APPOINTMENT_EVENT_TYPES,
  actorLabelKey,
  describeEvent,
  rescheduleCount,
  sortEvents,
  type AppointmentEvent,
} from '@/features/appointments';
import { en, es } from '@/locales';

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

/** A translator that answers with the key, so assertions are about keys. */
const echo = (key: string) => key;

describe('actorLabelKey', () => {
  it('names a key for every actor the database can produce', () => {
    for (const actor of APPOINTMENT_ACTOR_TYPES) {
      expect(actorLabelKey(actor)).toBe(`history.actor_${actor}`);
    }
  });
});

describe('describeEvent', () => {
  it('names who booked it, without deciding the word order', () => {
    const described = describeEvent(event({ type: 'created', actor: 'guest' }), clock, echo);

    expect(described.key).toBe('history.created');
    expect(described.values.actor).toBe('history.actor_guest');
  });

  it('hands the sentence both ends of a move, and assembles neither', () => {
    // Spanish and English place the actor and the times differently, so the
    // dictionary composes the line. A domain module doing it with template
    // literals would force one language's grammar on the other.
    const described = describeEvent(
      event({
        type: 'rescheduled',
        actor: 'guest',
        previousStartsAt: AT('2026-09-23T14:00:00.000Z'),
        newStartsAt: AT('2026-09-24T17:30:00.000Z'),
      }),
      clock,
      echo,
    );

    expect(described.key).toBe('history.rescheduled');
    expect(described.values.from).toBe('14:00');
    expect(described.values.to).toBe('17:30');
  });

  it('reads a cancellation as a cancellation, not as a status', () => {
    const described = describeEvent(
      event({ type: 'status_changed', previousStatus: 'confirmed', newStatus: 'cancelled' }),
      clock,
      echo,
    );

    expect(described.key).toBe('history.cancelled');
  });

  it('uses the status key for every other status change', () => {
    const described = describeEvent(
      event({ type: 'status_changed', newStatus: 'no_show' }),
      clock,
      echo,
    );

    expect(described.key).toBe('history.statusChanged');
    expect(described.values.status).toBe('appointments.status_no_show');
  });

  it('always produces a key that both dictionaries have', () => {
    for (const type of APPOINTMENT_EVENT_TYPES) {
      const described = describeEvent(event({ type, newStatus: 'confirmed' }), clock, echo);
      const [section, key] = described.key.split('.') as ['history', string];
      expect(es[section]).toHaveProperty(key);
      expect(en[section]).toHaveProperty(key);
    }
  });

  it('survives a reschedule event that lost one of its endpoints', () => {
    const described = describeEvent(
      event({ type: 'rescheduled', newStartsAt: AT('2026-09-24T17:30:00.000Z') }),
      clock,
      echo,
    );

    expect(described.values.from).toBe('history.unknownFrom');
    expect(described.values.to).toBe('17:30');
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
