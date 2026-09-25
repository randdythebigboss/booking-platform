import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Card, Dropdown, Screen, Text } from '@/components/ui';
import { NOTIFICATION_STATUSES, type NotificationStatus } from '@/features/notifications';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { fetchBusinessNotifications } from '@/services/notifications';
import { spacing } from '@/theme';

type StatusFilter = NotificationStatus | 'all';

/**
 * What the product is about to say to this business's customers.
 *
 * Operational rather than decorative: the question it answers is "did the
 * confirmation go out, and if not, why", which until now needed a SQL client.
 * It reads the outbox through Row Level Security like any other screen, so a
 * business sees its own rows and nobody else's, and it cannot write -- there
 * is no policy that would let it.
 *
 * The recipient's address is deliberately not shown. It is on the appointment
 * already, for whoever needs it; a list of messages is not a second place to
 * copy it to.
 */
export default function NotificationsScreen() {
  const { business } = useRequiredWorkspace();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const format = useFormat();
  const timezone = business.timezone;

  const [status, setStatus] = useState<StatusFilter>('all');

  const statuses = [
    { value: 'all' as const, label: t('appointments.everyStatus') },
    ...NOTIFICATION_STATUSES.map((value) => ({
      value,
      label: tk(`notifications.status.${value}`),
    })),
  ];

  const notifications = useAsyncData(
    () =>
      fetchBusinessNotifications(business.id, {
        statuses: status === 'all' ? undefined : [status],
      }),
    [business.id, status],
  );

  const rows = notifications.data ?? [];

  useRefreshOnFocus(notifications.reload);

  return (
    <Screen title={t('notifications.title')} subtitle={t('notifications.subtitle')}>
      <Dropdown
        label={t('appointments.status')}
        value={status}
        options={statuses}
        onChange={(next) => setStatus(next as StatusFilter)}
      />

      {notifications.loading && <ActivityIndicator />}

      {rows.length === 0 && !notifications.loading && (
        <Card>
          <Text variant="body" tone="muted">
            {t('notifications.none')}
          </Text>
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        {rows.map((notification) => {
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
              <Text variant="caption" tone={notification.status === 'failed' ? 'danger' : 'muted'}>
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
            <Link key={notification.id} href={`/app/appointments/${notification.appointmentId}`}>
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
    </Screen>
  );
}
