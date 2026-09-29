import { describe, expect, it } from 'vitest';

import { describeNotification, groupByDay, sameDay } from '@/features/notifications';
import type { NotificationItem } from '@/services/notifications';

/**
 * The branching that turns one row of appointment activity into a sentence.
 *
 * Worth testing on its own because the wrong branch is silent: a cancellation
 * described as a reschedule still renders, still links to the right
 * appointment, and still reads as a perfectly ordinary notification. Only the
 * meaning is wrong.
 */

const base: NotificationItem = {
  kind: 'event',
  id: '11111111-1111-4111-8111-111111111111',
  appointmentId: '22222222-2222-4222-8222-222222222222',
  occurredAt: new Date('2026-10-01T14:00:00Z'),
  eventType: 'created',
  previousStatus: null,
  newStatus: null,
  previousStartsAt: null,
  newStartsAt: null,
  appointmentStartsAt: new Date('2026-10-05T13:00:00Z'),
  customerName: 'Noti Prueba',
  serviceName: 'Corte de cabello',
  preview: null,
  isRead: false,
};

const item = (overrides: Partial<NotificationItem>): NotificationItem => ({
  ...base,
  ...overrides,
});

describe('describing a notification', () => {
  it('names the customer who booked', () => {
    const described = describeNotification(item({ eventType: 'created' }));

    expect(described.titleKey).toBe('notificationCentre.item.created');
    expect(described.values.customer).toBe('Noti Prueba');
    expect(described.showsPreview).toBe(false);
  });

  it('tells a reschedule apart from a status change', () => {
    const described = describeNotification(
      item({
        eventType: 'rescheduled',
        previousStartsAt: new Date('2026-10-05T13:00:00Z'),
        newStartsAt: new Date('2026-10-06T13:00:00Z'),
      }),
    );

    expect(described.titleKey).toBe('notificationCentre.item.rescheduled');
    expect(described.tone).toBe('warning');
  });

  it('says which status a status change arrived at', () => {
    for (const [status, tone] of [
      ['confirmed', 'success'],
      ['cancelled', 'danger'],
      ['no_show', 'warning'],
      ['completed', 'neutral'],
    ] as const) {
      const described = describeNotification(
        item({ eventType: 'status_changed', previousStatus: 'pending', newStatus: status }),
      );

      expect(described.titleKey).toBe(`notificationCentre.item.status.${status}`);
      expect(described.tone).toBe(tone);
    }
  });

  it('falls back rather than rendering an empty sentence for a status it has never seen', () => {
    const described = describeNotification(
      // The enum could grow. A missing key renders the key itself, which is
      // worse than a vaguer sentence.
      item({ eventType: 'status_changed', newStatus: null }),
    );

    expect(described.titleKey).toBe('notificationCentre.item.status.unknown');
    expect(described.mark).toBe('·');
  });

  it('shows what a message said, and only for a message', () => {
    const message = describeNotification(
      item({ kind: 'message', eventType: 'message', preview: 'Voy a llegar tarde' }),
    );
    expect(message.showsPreview).toBe(true);
    expect(message.titleKey).toBe('notificationCentre.item.message');

    expect(describeNotification(item({ eventType: 'created' })).showsPreview).toBe(false);
  });

  it('never carries the tone in colour alone', () => {
    for (const eventType of ['created', 'rescheduled', 'status_changed'] as const) {
      const described = describeNotification(item({ eventType, newStatus: 'confirmed' }));
      expect(described.mark.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('grouping by day', () => {
  it('groups in the business timezone, not the reader"s', () => {
    // 01:30 UTC on the 2nd is still the evening of the 1st in Santo Domingo.
    const late = item({ occurredAt: new Date('2026-10-02T01:30:00Z'), id: 'a' });
    const evening = item({ occurredAt: new Date('2026-10-01T23:00:00Z'), id: 'b' });

    expect(sameDay(late.occurredAt, evening.occurredAt, 'America/Santo_Domingo')).toBe(true);
    expect(sameDay(late.occurredAt, evening.occurredAt, 'UTC')).toBe(false);

    expect(groupByDay([late, evening], 'America/Santo_Domingo')).toHaveLength(1);
    expect(groupByDay([late, evening], 'UTC')).toHaveLength(2);
  });

  it('keeps the feed"s order and starts a group at each change of day', () => {
    const items = [
      item({ id: 'a', occurredAt: new Date('2026-10-03T15:00:00Z') }),
      item({ id: 'b', occurredAt: new Date('2026-10-03T12:00:00Z') }),
      item({ id: 'c', occurredAt: new Date('2026-10-01T12:00:00Z') }),
    ];

    const groups = groupByDay(items, 'America/Santo_Domingo');

    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((each) => each.id)).toEqual(['a', 'b']);
    expect(groups[1]?.items.map((each) => each.id)).toEqual(['c']);
  });

  it('is empty for nothing, rather than one empty group', () => {
    expect(groupByDay([], 'America/Santo_Domingo')).toEqual([]);
  });
});
