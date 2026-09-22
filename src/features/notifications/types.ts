/**
 * The vocabulary of the outbox, mirrored from the database enums.
 *
 * These are the SQL sentinels, not words for a reader: `booking_confirmed` is
 * an identity, and the sentence a customer sees is produced from it by the
 * template registry, in their language. Nothing here is ever displayed.
 */

export const NOTIFICATION_KINDS = [
  // For the professional: somebody booked.
  'booking_created',
  'booking_confirmed',
  'booking_rescheduled',
  'booking_cancelled',
  'booking_reminder',
  // For the customer: what happened to their money.
  'payment_received',
  'payment_failed',
  'payment_refunded',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_CHANNELS = ['email', 'sms', 'whatsapp', 'push', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Semantic template identifiers. Never an English sentence used as a key. */
export const TEMPLATE_KEYS = [
  'booking.confirmed',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.reminder',
  'payment.received',
  'payment.failed',
  'payment.refunded',
  'professional.booking_created',
  'professional.booking_rescheduled',
  'professional.booking_cancelled',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/**
 * What the database froze onto the row when it queued the message.
 *
 * Business-entered text -- the business, the professional, the service, the
 * customer's own name -- is carried through exactly as it was entered and is
 * never translated. See ADR 0017.
 */
export interface NotificationPayload {
  appointmentId: string;
  businessName: string;
  professionalName: string | null;
  serviceName: string | null;
  customerName: string;
  /** ISO 8601, UTC. An instant, never a wall clock. */
  startsAt: string;
  endsAt: string;
  /** The business's timezone, which is the one the appointment happens in. */
  timezone: string;
  /** Exact decimal, present only when the booking involved money. */
  amount?: string | null;
  currency?: string | null;
}

/** One row of the outbox, as a dispatcher sees it. */
export interface NotificationJob {
  id: string;
  businessId: string;
  appointmentId: string | null;
  kind: NotificationKind;
  channel: NotificationChannel;
  recipient: string;
  templateKey: TemplateKey;
  /** Chosen when the row was queued, so it cannot drift afterwards. */
  locale: string;
  payload: NotificationPayload;
  attemptCount: number;
  maxAttempts: number;
  scheduledFor: Date;
}

/** What a provider is asked to deliver. */
export interface NotificationMessage {
  subject: string;
  body: string;
}
