import type {
  NotificationChannel,
  NotificationKind,
  NotificationStatus,
} from '@/features/notifications';
import { toWorkspaceError } from '@/features/workspace';
import { getSupabase } from '@/lib/supabase';

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
