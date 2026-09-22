import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Share, View } from 'react-native';

import { AppointmentRow } from '@/components/appointment-row';
import { useRequiredWorkspace } from '@/components/providers';
import { OfflineNotice } from '@/components/offline-notice';
import { Button, Card, Feedback, Screen, Text } from '@/components/ui';
import { isoDateIn, zonedInstant } from '@/features/availability';
import { useFormat } from '@/i18n/use-format';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { shareOrCopy, webShareCapabilities } from '@/features/sharing';
import { publicBookingUrl } from '@/lib/env';
import { fetchAppointments } from '@/services/appointments';
import { signOut } from '@/services/auth';
import { spacing } from '@/theme';

const UPCOMING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export default function DashboardScreen() {
  const { business, professional } = useRequiredWorkspace();
  const router = useRouter();
  const { t } = useTranslation();
  const format = useFormat();
  const timezone = business.timezone;
  const [signingOut, setSigningOut] = useState(false);

  const today = isoDateIn(new Date(), timezone);
  const dayStart = zonedInstant(today, 0, timezone);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const horizon = new Date(dayStart.getTime() + UPCOMING_DAYS * DAY_MS);

  const todays = useAsyncData(
    () =>
      fetchAppointments({
        businessId: business.id,
        from: dayStart,
        to: dayEnd,
        statuses: ['pending', 'confirmed', 'completed', 'no_show'],
      }),
    [business.id, today],
  );

  const upcoming = useAsyncData(
    () =>
      fetchAppointments({
        businessId: business.id,
        from: new Date(),
        to: horizon,
        statuses: ['pending', 'confirmed'],
      }),
    [business.id, today],
  );

  const next = (upcoming.data ?? [])[0] ?? null;
  const pendingCount = (upcoming.data ?? []).filter((a) => a.status === 'pending').length;
  const link = publicBookingUrl(business.slug);
  const [shared, setShared] = useState<'shared' | 'copied' | 'unsupported' | 'dismissed' | null>(
    null,
  );

  /**
   * Hands the link over, using whatever the platform already has.
   *
   * On a phone that is the share sheet the person already uses; on a desktop
   * browser it is the clipboard. Nothing is sent by the product, and no
   * messaging provider is involved.
   */
  async function share() {
    const capabilities =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? webShareCapabilities(window)
        : {
            share: async ({ url, title }: { url: string; title?: string }) => {
              await Share.share({ message: url, url, title });
            },
          };

    setShared(await shareOrCopy(link, capabilities, { title: business.name }));
  }

  useRefreshOnFocus(todays.reload);
  useRefreshOnFocus(upcoming.reload);

  return (
    <Screen title={business.name} subtitle={professional?.displayName ?? undefined}>
      <OfflineNotice />

      <Card>
        <Text variant="label">{t('dashboard.nextAppointment')}</Text>
        {upcoming.loading && <ActivityIndicator />}
        {!upcoming.loading && !next && (
          <Text variant="body" tone="muted">
            {t('dashboard.noNextAppointment')}
          </Text>
        )}
        {next && (
          <>
            <Text variant="title">{format.time(next.startsAt, timezone)}</Text>
            <Text variant="body">{format.date(next.startsAt, timezone)}</Text>
            <Text variant="body" tone="muted">
              {next.customer.fullName}
              {next.items[0] ? ' · ' + next.items[0].name : ''}
            </Text>
          </>
        )}
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Card style={{ flex: 1 }}>
          <Text variant="title">{(upcoming.data ?? []).length}</Text>
          <Text variant="caption" tone="muted">
            {t('dashboard.upcoming')}
          </Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text variant="title" tone={pendingCount > 0 ? 'accent' : 'default'}>
            {pendingCount}
          </Text>
          <Text variant="caption" tone="muted">
            {t('dashboard.awaitingConfirmation')}
          </Text>
        </Card>
      </View>

      <Text variant="heading">{t('dashboard.today')}</Text>
      {todays.loading && <ActivityIndicator />}
      {todays.error && <Feedback tone="danger" message={todays.error} />}
      {!todays.loading && (todays.data ?? []).length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            {t('dashboard.nothingToday')}
          </Text>
        </Card>
      )}
      <View style={{ gap: spacing.sm }}>
        {(todays.data ?? []).map((appointment) => (
          <AppointmentRow
            key={appointment.id}
            appointment={appointment}
            timezone={timezone}
            showDate={false}
          />
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Link href="/app/calendar" asChild>
          <Button label={t('nav.calendar')} variant="secondary" />
        </Link>
        <Link href="/app/appointments" asChild>
          <Button label={t('nav.appointments')} variant="secondary" />
        </Link>
        <Link href="/app/availability" asChild>
          <Button label={t('nav.availability')} variant="secondary" />
        </Link>
        <Link href="/app/services" asChild>
          <Button label={t('nav.services')} variant="secondary" />
        </Link>
        <Link href="/app/notifications" asChild>
          <Button label={t('nav.notifications')} variant="secondary" />
        </Link>
        <Link href="/app/settings" asChild>
          <Button label={t('nav.settings')} variant="secondary" />
        </Link>
      </View>

      <Card>
        <Text variant="label">{t('dashboard.yourBookingLink')}</Text>
        <Text variant="body" tone="accent" selectable>
          {link}
        </Text>
        {business.isPublished ? (
          <Text variant="caption" tone="success">
            {t('dashboard.published')}
          </Text>
        ) : (
          <Feedback tone="muted" message={t('dashboard.notPublished')} />
        )}
        <Button label={t('dashboard.shareLink')} variant="secondary" onPress={share} />

        {shared === 'copied' && (
          <Text variant="caption" tone="success">
            {t('dashboard.linkCopied')}
          </Text>
        )}
        {shared === 'unsupported' && (
          <Text variant="caption" tone="muted">
            {t('dashboard.linkCopyUnsupported')}
          </Text>
        )}

        <Link href={`/p/${business.slug}`} asChild>
          <Button label={t('dashboard.openPublicPage')} variant="secondary" />
        </Link>
      </Card>

      <Button
        label={t('auth.signOut')}
        variant="ghost"
        loading={signingOut}
        onPress={async () => {
          setSigningOut(true);
          try {
            await signOut();
            router.replace('/login');
          } finally {
            setSigningOut(false);
          }
        }}
      />
    </Screen>
  );
}
