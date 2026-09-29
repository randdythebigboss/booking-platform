import type { NotificationItem } from '@/services/notifications';

/**
 * Turning one row of appointment activity into a sentence somebody reads.
 *
 * ---------------------------------------------------------------------------
 * Why this is not in the screen
 * ---------------------------------------------------------------------------
 *
 * Because the interesting part is the branching, not the layout: a status
 * change means five different things depending on the status, a reschedule has
 * to say what it moved from, and a cancellation by the customer reads
 * differently from one the shop made. That is logic, and logic in a component
 * is logic nobody tests.
 *
 * It returns keys and values rather than text so the caller translates them,
 * which is what keeps Spanish and English in step. See the `notificationCentre`
 * block in the locales.
 */

export type NotificationTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

export interface DescribedNotification {
  /** Translation key for the headline. */
  titleKey: string;
  /** Interpolation values the headline needs. */
  values: Record<string, string>;
  /** A short mark, so the tone is never carried by colour alone. */
  mark: string;
  tone: NotificationTone;
  /** True when the row should say what the message said. */
  showsPreview: boolean;
}

const STATUS_TONE: Record<string, NotificationTone> = {
  pending: 'warning',
  confirmed: 'success',
  completed: 'neutral',
  cancelled: 'danger',
  no_show: 'warning',
};

const STATUS_MARK: Record<string, string> = {
  pending: '…',
  confirmed: '✓',
  completed: '✓',
  cancelled: '✕',
  no_show: '!',
};

export function describeNotification(item: NotificationItem): DescribedNotification {
  const values: Record<string, string> = {
    customer: item.customerName,
    service: item.serviceName ?? '',
  };

  if (item.kind === 'message') {
    return {
      titleKey: 'notificationCentre.item.message',
      values,
      mark: '✉',
      tone: 'accent',
      showsPreview: true,
    };
  }

  if (item.eventType === 'created') {
    return {
      titleKey: 'notificationCentre.item.created',
      values,
      mark: '+',
      tone: 'accent',
      showsPreview: false,
    };
  }

  if (item.eventType === 'rescheduled') {
    return {
      titleKey: 'notificationCentre.item.rescheduled',
      values,
      mark: '⇄',
      tone: 'warning',
      showsPreview: false,
    };
  }

  // A status change. Which one matters more than the fact that it was one.
  const status = item.newStatus ?? '';
  return {
    titleKey: `notificationCentre.item.status.${status || 'unknown'}`,
    values,
    mark: STATUS_MARK[status] ?? '·',
    tone: STATUS_TONE[status] ?? 'neutral',
    showsPreview: false,
  };
}

/**
 * Whether two items belong under the same date heading.
 *
 * Compared in the business's timezone, not the reader's: a professional in a
 * different country still thinks of the shop's day, and an appointment at ten
 * at night should not be filed under tomorrow because the phone is in Madrid.
 */
export function sameDay(a: Date, b: Date, timezone: string): boolean {
  const key = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  return key(a) === key(b);
}

/**
 * The items, oldest heading first, grouped into the days they happened on.
 *
 * The feed arrives newest first and stays that way; this only decides where a
 * heading goes.
 */
export function groupByDay(
  items: NotificationItem[],
  timezone: string,
): { day: Date; items: NotificationItem[] }[] {
  const groups: { day: Date; items: NotificationItem[] }[] = [];

  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && sameDay(last.day, item.occurredAt, timezone)) {
      last.items.push(item);
    } else {
      groups.push({ day: item.occurredAt, items: [item] });
    }
  }

  return groups;
}
