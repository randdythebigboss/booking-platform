import type { AppointmentStatus } from '@/types/domain';

import { statusLabel } from './lifecycle';

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

/**
 * Who did it, in the words a professional would use.
 *
 * "The system" is deliberately vague rather than reassuring: it means nobody
 * signed the change, which is worth noticing.
 */
export function actorLabel(actor: AppointmentActorType): string {
  switch (actor) {
    case 'professional':
      return 'You';
    case 'guest':
      return 'The customer';
    case 'system':
      return 'The system';
    default:
      return actor;
  }
}

/**
 * One line describing what happened, without the timestamp -- the UI places
 * that itself, formatted in the business timezone.
 *
 * `formatTime` is injected rather than imported so this stays a pure function
 * of its inputs and can be tested without a timezone database.
 */
export function describeEvent(
  event: AppointmentEvent,
  formatTime: (at: Date) => string,
): string {
  switch (event.type) {
    case 'created':
      return `${actorLabel(event.actor)} booked this appointment`;

    case 'rescheduled': {
      const from = event.previousStartsAt ? formatTime(event.previousStartsAt) : 'an earlier time';
      const to = event.newStartsAt ? formatTime(event.newStartsAt) : 'a new time';
      return `${actorLabel(event.actor)} moved it from ${from} to ${to}`;
    }

    case 'status_changed': {
      if (!event.newStatus) return `${actorLabel(event.actor)} changed the status`;
      const verb = event.newStatus === 'cancelled' ? 'cancelled it' : null;
      if (verb) return `${actorLabel(event.actor)} ${verb}`;
      return `${actorLabel(event.actor)} marked it ${statusLabel(event.newStatus).toLowerCase()}`;
    }

    default:
      return 'Something changed';
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
