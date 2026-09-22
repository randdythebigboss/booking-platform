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

/**
 * What happened, as a translation key plus the values its sentence needs.
 *
 * **The actor is part of the key, not a value.** Interpolating it reads fine
 * in English -- "You booked", "The customer booked", one verb form for both --
 * and is wrong in Spanish, where the verb agrees with the person: "Reservaste"
 * against "El cliente reservó". A language whose grammar depends on who acted
 * has to be allowed to write the whole sentence, so each actor gets its own
 * key and each language fills it in naturally.
 *
 * Found in a browser, in Spanish, reading "Tú reservó esta cita".
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
  const actor = event.actor;

  switch (event.type) {
    case 'created':
      return { key: `history.created_${actor}`, values: {} };

    case 'rescheduled':
      return {
        key: `history.rescheduled_${actor}`,
        values: {
          from: event.previousStartsAt
            ? formatTime(event.previousStartsAt)
            : translate('history.unknownFrom'),
          to: event.newStartsAt ? formatTime(event.newStartsAt) : translate('history.unknownTo'),
        },
      };

    case 'status_changed': {
      if (!event.newStatus) return { key: `history.statusChangedPlain_${actor}`, values: {} };
      if (event.newStatus === 'cancelled') return { key: `history.cancelled_${actor}`, values: {} };
      return {
        key: `history.statusChanged_${actor}`,
        values: { status: translate(statusLabelKey(event.newStatus)).toLowerCase() },
      };
    }

    default:
      return { key: `history.statusChangedPlain_${actor}`, values: {} };
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
