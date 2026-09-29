import type {
  NotificationChannel,
  NotificationKind,
  NotificationStatus,
} from '@/features/notifications';
import { toWorkspaceError } from '@/features/workspace';
import { getSupabase } from '@/lib/supabase';
import type { AppointmentStatus } from '@/types/domain';

/**
 * Reading the outbox from the professional's side.
 *
 * Read-only, and it has to be: the table has a SELECT policy for members of
 * the business and no write policy at all, so this can show what happened and
 * nothing here can change it. Row Level Security is what scopes the answer --
 * the business id below narrows the query, it does not enforce anything.
 *
 * The recipient is deliberately not selected. A professional can already see
 * their customer's email on the appointment; a list of queued messages does
 * not need to be a second place it is copied to.
 */

export interface NotificationRecord {
  id: string;
  appointmentId: string | null;
  kind: NotificationKind;
  channel: NotificationChannel;
  status: NotificationStatus;
  locale: string;
  scheduledFor: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  attemptCount: number;
  lastError: string | null;
  customerName: string | null;
}

const COLUMNS =
  'id, appointment_id, kind, channel, status, locale, scheduled_for, sent_at, failed_at,' +
  ' attempt_count, last_error, payload';

function toRecord(row: Record<string, any>): NotificationRecord {
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  return {
    id: String(row.id),
    appointmentId: row.appointment_id ? String(row.appointment_id) : null,
    kind: row.kind as NotificationKind,
    channel: row.channel as NotificationChannel,
    status: row.status as NotificationStatus,
    locale: String(row.locale),
    scheduledFor: new Date(String(row.scheduled_for)),
    sentAt: row.sent_at ? new Date(String(row.sent_at)) : null,
    failedAt: row.failed_at ? new Date(String(row.failed_at)) : null,
    attemptCount: Number(row.attempt_count ?? 0),
    lastError: row.last_error ?? null,
    customerName: typeof payload.customerName === 'string' ? payload.customerName : null,
  };
}

export async function fetchBusinessNotifications(
  businessId: string,
  options: { statuses?: NotificationStatus[]; limit?: number } = {},
): Promise<NotificationRecord[]> {
  let query = getSupabase()
    .from('notifications')
    .select(COLUMNS)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50);

  if (options.statuses && options.statuses.length > 0) {
    query = query.in('status', options.statuses);
  }

  const { data, error } = await query;
  if (error) throw toWorkspaceError(error);

  return (data ?? []).map(toRecord);
}

export async function fetchAppointmentNotifications(
  appointmentId: string,
): Promise<NotificationRecord[]> {
  const { data, error } = await getSupabase()
    .from('notifications')
    .select(COLUMNS)
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: true });

  if (error) throw toWorkspaceError(error);

  return (data ?? []).map(toRecord);
}

// ===========================================================================
// The notification centre
//
// Everything above this line is the outbox: what the product will try to send
// to a customer, and whether it managed. Everything below is what a
// professional is told when they open the application, which is a different
// question with a different audience and, deliberately, a different shape.
//
// The rows come from `list_professional_notifications`, which reads the
// appointment event log and the conversation together. Nothing is copied into
// a notifications table: see the 20261001100000 migration for why.
// ===========================================================================

export type NotificationItemKind = 'event' | 'message';

export type NotificationEventType = 'created' | 'status_changed' | 'rescheduled' | 'message';

export interface NotificationItem {
  kind: NotificationItemKind;
  id: string;
  appointmentId: string;
  occurredAt: Date;
  eventType: NotificationEventType;
  previousStatus: AppointmentStatus | null;
  newStatus: AppointmentStatus | null;
  previousStartsAt: Date | null;
  newStartsAt: Date | null;
  appointmentStartsAt: Date;
  customerName: string;
  serviceName: string | null;
  /** The opening of a customer's message. Never present on an event. */
  preview: string | null;
  isRead: boolean;
}

function toItem(row: Record<string, any>): NotificationItem {
  return {
    kind: row.kind as NotificationItemKind,
    id: String(row.id),
    appointmentId: String(row.appointment_id),
    occurredAt: new Date(String(row.occurred_at)),
    eventType: row.event_type as NotificationEventType,
    previousStatus: (row.previous_status ?? null) as AppointmentStatus | null,
    newStatus: (row.new_status ?? null) as AppointmentStatus | null,
    previousStartsAt: row.previous_starts_at ? new Date(String(row.previous_starts_at)) : null,
    newStartsAt: row.new_starts_at ? new Date(String(row.new_starts_at)) : null,
    appointmentStartsAt: new Date(String(row.appointment_starts_at)),
    customerName: String(row.customer_name),
    serviceName: row.service_name ? String(row.service_name) : null,
    preview: row.preview ? String(row.preview) : null,
    isRead: Boolean(row.is_read),
  };
}

/** What has happened to this business's appointments, newest first. */
export async function fetchNotificationFeed(
  businessId: string,
  limit = 50,
): Promise<NotificationItem[]> {
  const { data, error } = await getSupabase().rpc('list_professional_notifications', {
    p_business_id: businessId,
    p_limit: limit,
  });

  if (error) throw toWorkspaceError(error);
  return ((data ?? []) as Record<string, any>[]).map(toItem);
}

/** The number on the badge. */
export async function fetchUnreadNotificationCount(businessId: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('count_unread_notifications', {
    p_business_id: businessId,
  });

  if (error) throw toWorkspaceError(error);
  return Number(data ?? 0);
}

/**
 * Marks one item read.
 *
 * For a message this sets the same `read_at` the conversation uses, so the two
 * screens cannot disagree about it. See the migration header.
 */
export async function markNotificationRead(
  businessId: string,
  kind: NotificationItemKind,
  id: string,
): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('mark_notification_read', {
    p_business_id: businessId,
    p_kind: kind,
    p_id: id,
  });

  if (error) throw toWorkspaceError(error);
  return Boolean(data);
}

/** Marks everything in the window read, and says how many that was. */
export async function markAllNotificationsRead(businessId: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('mark_all_notifications_read', {
    p_business_id: businessId,
  });

  if (error) throw toWorkspaceError(error);
  return Number(data ?? 0);
}
