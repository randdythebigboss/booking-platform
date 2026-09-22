import type { AppointmentStatus } from '@/types/domain';

import { statusLabelKey } from './lifecycle';

export const APPOINTMENT_EVENT_TYPES = ['created', 'status_changed', 'rescheduled'] as const;
export type AppointmentEventType = (typeof APPOINTMENT_EVENT_TYPES)[number];

export const APPOINTMENT_ACTOR_TYPES = ['professional', 'guest', 'system'] as const;
export type AppointmentActorType = (typeof APPOINTMENT_ACTOR_TYPES)[number];

export interface AppointmentEvent {
  id: string;
  type: AppointmentEventType;
  actor: AppointmentActorType;
  occurredAt: Date;
  previousStatus: AppointmentStatus | null;
  newStatus: AppointmentStatus | null;
  previousStartsAt: Date | null;
  newStartsAt: Date | null;
  reason: string | null;
}

/** The key naming who acted, in the words a professional would use. */
export function actorLabelKey(actor: AppointmentActorType): string {
  return `history.actor_${actor}`;
}

/**
 * What happened, as a translation key plus the values its sentence needs.
 *
 * The line is assembled by the dictionary, not here: Spanish and English put
 * the actor, the old time and the new time in different places, and a domain
 * module concatenating them would force one language's word order on both.
 */
export interface EventDescription {
  key: string;
  values: Record<string, string>;
}

export function describeEvent(
  event: AppointmentEvent,
  formatTime: (at: Date) => string,
  translate: (key: string) => string,
): EventDescription {
  const actor = translate(actorLabelKey(event.actor));

  switch (event.type) {
    case 'created':
      return { key: 'history.created', values: { actor } };

    case 'rescheduled':
      return {
        key: 'history.rescheduled',
        values: {
          actor,
          from: event.previousStartsAt
            ? formatTime(event.previousStartsAt)
            : translate('history.unknownFrom'),
          to: event.newStartsAt ? formatTime(event.newStartsAt) : translate('history.unknownTo'),
        },
      };

    case 'status_changed': {
      if (!event.newStatus) return { key: 'history.statusChangedPlain', values: { actor } };
      if (event.newStatus === 'cancelled') return { key: 'history.cancelled', values: { actor } };
      return {
        key: 'history.statusChanged',
        values: { actor, status: translate(statusLabelKey(event.newStatus)).toLowerCase() },
      };
    }

    default:
      return { key: 'history.statusChangedPlain', values: { actor } };
  }
}

/** Oldest first: history reads as a story, not as a feed. */
export function sortEvents(events: AppointmentEvent[]): AppointmentEvent[] {
  return [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/**
 * True when this appointment has been moved at least once.
 *
 * Worth surfacing on the detail screen: "moved twice" is context a
 * professional wants before they move it a third time.
 */
export function rescheduleCount(events: AppointmentEvent[]): number {
  return events.filter((event) => event.type === 'rescheduled').length;
}
