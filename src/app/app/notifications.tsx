import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Badge, Button, Card, Dropdown, Feedback, Segmented, Text } from '@/components/ui';
import { WorkspaceShell } from '@/components/workspace-shell';
import {
  NOTIFICATION_STATUSES,
  describeNotification,
  groupByDay,
  type NotificationStatus,
} from '@/features/notifications';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
import {
  fetchBusinessNotifications,
  fetchNotificationFeed,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from '@/services/notifications';
import { radius, spacing, useTheme } from '@/theme';

type StatusFilter = NotificationStatus | 'all';
type Tab = 'activity' | 'delivery';

/**
 * What has happened to this business's appointments.
 *
 * ---------------------------------------------------------------------------
 * What this screen used to be
 * ---------------------------------------------------------------------------
 *
 * The outbox: which reminder was queued, which one failed, how many attempts.
 * That is worth having -- it is the only way to answer "did the confirmation go
 * out" without a SQL client -- but it is not what somebody opens the
 * application to find out. They want to know that a slot was taken, that a
 * customer moved, that somebody wrote.
 *
 * So the outbox is still here, under its own tab, and the first thing the
 * screen shows is the answer to the question that gets asked.
 *
 * ---------------------------------------------------------------------------
 * Reading is a side effect of opening, not of scrolling
 * ---------------------------------------------------------------------------
 *
 * A row is marked read when it is pressed, not when it happens to be on
 * screen. "I scrolled past it" and "I dealt with it" are different facts and
 * the badge should only count the second.
 */
export default function NotificationsScreen() {
  const { business, professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const format = useFormat();
  const { palette } = useTheme();
  const timezone = business.timezone;

  const [tab, setTab] = useState<Tab>('activity');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('all');

  const feed = useAsyncData(() => fetchNotificationFeed(business.id), [business.id]);
  useRefreshOnFocus(feed.reload);

  const deliveries = useAsyncData(
    () =>
      tab === 'delivery'
        ? fetchBusinessNotifications(business.id, {
            statuses: status === 'all' ? undefined : [status],
          })
        : Promise.resolve([]),
    [business.id, status, tab],
  );

  const items = feed.data ?? [];
  const unreadCount = items.filter((item) => !item.isRead).length;
  const shown = onlyUnread ? items.filter((item) => !item.isRead) : items;
  const groups = groupByDay(shown, timezone);

  async function openItem(item: NotificationItem) {
    if (item.isRead) return;
    try {
      await markNotificationRead(business.id, item.kind, item.id);
      feed.reload();
    } catch {
      // The link still works. A badge that is one out is not worth an error
      // message across the screen somebody is trying to read.
    }
  }

  async function markEverything() {
    await markAllNotificationsRead(business.id);
    feed.reload();
  }

  const statuses = [
    { value: 'all' as const, label: t('appointments.everyStatus') },
    ...NOTIFICATION_STATUSES.map((value) => ({
      value,
      label: tk(`notifications.status.${value}`),
    })),
  ];

  return (
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      narrow
      title={t('notificationCentre.title')}
      subtitle={t('notificationCentre.subtitle')}
    >
      <Segmented
        label={t('notificationCentre.title')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'activity', label: t('notificationCentre.tabActivity') },
          { value: 'delivery', label: t('notificationCentre.tabDelivery') },
        ]}
      />

      {tab === 'activity' ? (
        <>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.sm,
              flexWrap: 'wrap',
            }}
          >
            <Segmented
              label={t('notificationCentre.unread')}
              value={onlyUnread ? 'unread' : 'all'}
              onChange={(next) => setOnlyUnread(next === 'unread')}
              options={[
                { value: 'all', label: t('notificationCentre.all') },
                {
                  value: 'unread',
                  label: unreadCount
                    ? `${t('notificationCentre.onlyUnread')} (${unreadCount})`
                    : t('notificationCentre.onlyUnread'),
                },
              ]}
            />
            {unreadCount > 0 && (
              <Button
                label={t('notificationCentre.markAllRead')}
                variant="secondary"
                onPress={markEverything}
              />
            )}
          </View>

          {feed.loading && <ActivityIndicator />}

          {/*
            An empty list and a list that could not be loaded look identical,
            and only one of them means "nothing has happened". A project whose
            database has not had the notification migration yet answers 404 to
            the RPC, so saying "nothing new" there would be a lie the
            professional has no way to see through.
          */}
          {!feed.loading && feed.error && (
            <Feedback tone="warning" message={t('notificationCentre.unavailable')} />
          )}

          {!feed.loading && !feed.error && shown.length === 0 && (
            <Card>
              <Text variant="body" tone="muted">
                {onlyUnread ? t('notificationCentre.noneUnread') : t('notificationCentre.none')}
              </Text>
            </Card>
          )}

          {groups.map((group) => (
            <View key={group.day.toISOString()} style={{ gap: spacing.sm }}>
              <Text variant="label" tone="muted">
                {format.date(group.day, timezone)}
              </Text>

              {group.items.map((item) => {
                const described = describeNotification(item);

                return (
                  <Link
                    key={`${item.kind}:${item.id}`}
                    href={`/app/appointments/${item.appointmentId}`}
                    asChild
                  >
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`${tk(described.titleKey, described.values)} · ${t('notificationCentre.openAppointment')}`}
                      onPress={() => openItem(item)}
                      style={{
                        flexDirection: 'row',
                        gap: spacing.md,
                        alignItems: 'flex-start',
                        padding: spacing.md,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: item.isRead ? palette.borderSubtle : palette.border,
                        backgroundColor: item.isRead ? 'transparent' : palette.surface,
                      }}
                    >
                      <Text
                        variant="body"
                        accessibilityElementsHidden
                        style={{ width: 20, textAlign: 'center', color: palette.accent }}
                      >
                        {described.mark}
                      </Text>

                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="label">{tk(described.titleKey, described.values)}</Text>

                        <Text variant="caption" tone="muted">
                          {item.serviceName ? `${item.serviceName} · ` : ''}
                          {format.dateTime(item.appointmentStartsAt, timezone)}
                        </Text>

                        {described.showsPreview && item.preview && (
                          <Text variant="caption" numberOfLines={2}>
                            {item.preview}
                          </Text>
                        )}

                        {item.eventType === 'rescheduled' && item.previousStartsAt && (
                          <Text variant="caption" tone="muted">
                            {format.dateTime(item.previousStartsAt, timezone)} {'→'}{' '}
                            {item.newStartsAt
                              ? format.dateTime(item.newStartsAt, timezone)
                              : format.dateTime(item.appointmentStartsAt, timezone)}
                          </Text>
                        )}
                      </View>

                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text variant="caption" tone="muted">
                          {format.time(item.occurredAt, timezone)}
                        </Text>
                        {!item.isRead && (
                          <Badge label={t('notificationCentre.unread')} tone="accent" mark="●" />
                        )}
                      </View>
                    </Pressable>
                  </Link>
                );
              })}
            </View>
          ))}

          <Text variant="caption" tone="muted">
            {t('notificationCentre.inAppOnly')}
          </Text>
        </>
      ) : (
        <>
          <Dropdown
            label={t('appointments.status')}
            value={status}
            options={statuses}
            onChange={(next) => setStatus(next as StatusFilter)}
          />

          {deliveries.loading && <ActivityIndicator />}

          {!deliveries.loading && (deliveries.data ?? []).length === 0 && (
            <Card>
              <Text variant="body" tone="muted">
                {t('notifications.none')}
              </Text>
            </Card>
          )}

          <View style={{ gap: spacing.sm }}>
            {(deliveries.data ?? []).map((notification) => {
              const body = (
                <Card>
                  <Text variant="body">
                    {tk(`notifications.kind.${notification.kind}`)} {'·'}{' '}
                    {tk(`notifications.channel.${notification.channel}`)}
                  </Text>
                  {notification.customerName && (
                    <Text variant="caption" tone="muted">
                      {notification.customerName}
                    </Text>
                  )}
                  <Text
                    variant="caption"
                    tone={notification.status === 'failed' ? 'danger' : 'muted'}
                  >
                    {tk(`notifications.status.${notification.status}`)} {'·'}{' '}
                    {notification.sentAt
                      ? t('notifications.sentAt', {
                          when: format.dateTime(notification.sentAt, timezone),
                        })
                      : notification.failedAt
                        ? t('notifications.failedAt', {
                            when: format.dateTime(notification.failedAt, timezone),
                          })
                        : t('notifications.scheduledFor', {
                            when: format.dateTime(notification.scheduledFor, timezone),
                          })}
                    {notification.attemptCount > 0
                      ? ` · ${t('notifications.attempts', { count: notification.attemptCount })}`
                      : ''}
                  </Text>
                  {notification.lastError && (
                    <Text variant="caption" tone="danger">
                      {notification.lastError}
                    </Text>
                  )}
                </Card>
              );

              return notification.appointmentId ? (
                <Link
                  key={notification.id}
                  href={`/app/appointments/${notification.appointmentId}`}
                >
                  {body}
                </Link>
              ) : (
                <View key={notification.id}>{body}</View>
              );
            })}
          </View>

          <Text variant="caption" tone="muted">
            {t('notifications.developmentDelivery')}
          </Text>
        </>
      )}
    </WorkspaceShell>
  );
}
