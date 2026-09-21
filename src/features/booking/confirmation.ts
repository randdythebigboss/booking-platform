import type { AppointmentStatus } from '@/types/domain';

/**
 * What a guest may see about their own appointment.
 *
 * Shaped by what `public.get_appointment_by_token` returns, which is
 * deliberately only this: their booking, the business they booked with, and
 * how to reach it. No other customer, no other appointment, no calendar.
 */
export interface GuestAppointmentItem {
  name: string;
  durationMinutes: number;
  price: number;
  currency: string;
}

export interface GuestAppointment {
  appointmentId: string;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  businessName: string;
  businessSlug: string;
  businessPhone: string | null;
  businessAddress: string | null;
  professionalName: string;
  customerName: string;
  items: GuestAppointmentItem[];
  canCancel: boolean;
}

export class MalformedConfirmationError extends Error {
  constructor(field: string) {
    super(`The appointment response is missing or malformed: ${field}.`);
    this.name = 'MalformedConfirmationError';
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedConfirmationError(field);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedConfirmationError(field);
  }
  return value;
}

function instant(value: unknown, field: string): Date {
  const parsed = new Date(text(value, field));
  if (Number.isNaN(parsed.getTime())) throw new MalformedConfirmationError(field);
  return parsed;
}

export function parseGuestAppointment(raw: unknown): GuestAppointment {
  const root = record(raw, 'appointment');
  const items = Array.isArray(root.items) ? root.items : [];

  return {
    appointmentId: text(root.appointmentId, 'appointmentId'),
    status: text(root.status, 'status') as AppointmentStatus,
    startsAt: instant(root.startsAt, 'startsAt'),
    endsAt: instant(root.endsAt, 'endsAt'),
    timezone: text(root.timezone, 'timezone'),
    businessName: text(root.businessName, 'businessName'),
    businessSlug: text(root.businessSlug, 'businessSlug'),
    businessPhone: (root.businessPhone as string | null) ?? null,
    businessAddress: (root.businessAddress as string | null) ?? null,
    professionalName: text(root.professionalName, 'professionalName'),
    customerName: text(root.customerName, 'customerName'),
    items: items.map((entry, index) => {
      const item = record(entry, `items[${index}]`);
      return {
        name: text(item.name, `items[${index}].name`),
        durationMinutes: Number(item.durationMinutes),
        price: Number(item.price),
        currency: text(item.currency, `items[${index}].currency`),
      };
    }),
    canCancel: root.canCancel === true,
  };
}

/** Plain words for a status, so a customer is not shown a database enum. */
export function describeStatus(status: AppointmentStatus): string {
  switch (status) {
    case 'confirmed':
      return 'Confirmed';
    case 'pending':
      return 'Waiting for confirmation';
    case 'cancelled':
      return 'Cancelled';
    case 'completed':
      return 'Completed';
    case 'no_show':
      return 'Missed';
    default:
      return status;
  }
}
