import type { AppointmentStatus } from '@/types/domain';

/**
 * The appointment lifecycle, mirrored from the database.
 *
 * `public.appointment_transition_allowed` is the authority; this exists so the
 * UI can offer the right buttons instead of letting someone press one and be
 * refused. If the two ever disagree, the database wins and the professional
 * sees an error -- which is the correct failure direction.
 */
export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
};

/** Statuses that still occupy the calendar. Matches the exclusion constraint. */
export const BLOCKING_STATUSES: AppointmentStatus[] = ['pending', 'confirmed'];

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export interface AppointmentAction {
  status: AppointmentStatus;
  label: string;
  /** Destructive actions get a quieter button and a confirmation. */
  destructive: boolean;
}

const ACTION_LABELS: Record<AppointmentStatus, string> = {
  confirmed: 'Confirm',
  completed: 'Mark completed',
  no_show: 'Mark no-show',
  cancelled: 'Cancel',
  pending: 'Move back to pending',
};

/**
 * What a professional may actually do with this appointment right now.
 *
 * Completing or marking a no-show before the appointment has started is
 * refused by the database, so those are not offered either: an appointment
 * that has not begun cannot have been missed or finished.
 */
export function availableActions(
  status: AppointmentStatus,
  startsAt: Date,
  now: Date = new Date(),
): AppointmentAction[] {
  const hasStarted = startsAt.getTime() <= now.getTime();

  return ALLOWED_TRANSITIONS[status]
    .filter((next) => (next === 'completed' || next === 'no_show' ? hasStarted : true))
    .map((next) => ({
      status: next,
      label: ACTION_LABELS[next],
      destructive: next === 'cancelled' || next === 'no_show',
    }));
}

/** Words a professional reads, not a database enum. */
export function statusLabel(status: AppointmentStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'confirmed':
      return 'Confirmed';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'no_show':
      return 'No-show';
    default:
      return status;
  }
}

export type StatusTone = 'default' | 'muted' | 'accent' | 'danger' | 'success';

export function statusTone(status: AppointmentStatus): StatusTone {
  switch (status) {
    case 'confirmed':
      return 'success';
    case 'pending':
      return 'accent';
    case 'cancelled':
    case 'no_show':
      return 'danger';
    default:
      return 'muted';
  }
}
