import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Share, View } from 'react-native';

import { AppointmentRow, statusBadge } from '@/components/appointment-row';
import { OfflineNotice } from '@/components/offline-notice';
import { SetupChecklist, type SetupStep } from '@/components/setup-checklist';
import { Badge, Button, Card, EmptyState, PressableLink, Stat, Text } from '@/components/ui';
import { useRequiredWorkspace } from '@/components/providers';
import { WorkspaceShell } from '@/components/workspace-shell';
import { statusLabelKey } from '@/features/appointments';
import { isoDateIn, zonedInstant } from '@/features/availability';
import { shareOrCopy, webShareCapabilities } from '@/features/sharing';
import { useAsyncData } from '@/hooks/use-async-data';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
import { publicBookingUrl } from '@/lib/env';
import { fetchAppointments, type ProfessionalAppointment } from '@/services/appointments';
import { fetchWeeklySchedule } from '@/services/schedule-admin';
import { fetchServices } from '@/services/service-admin';
import { radius, spacing, useTheme } from '@/theme';

const UPCOMING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The screen a professional opens in the morning.
 *
 * It answers three questions in order: who is next, what does the rest of
 * today look like, and is there anything waiting for me. Everything else --
 * the setup guide, the public link, the quick actions -- sits below that,
 * because it is occasional and the first three are daily.
 *
 * The version this replaced put six identical grey navigation buttons at the
 * bottom of the page and a full-height card containing the sentence "Hoy no
 * tienes nada." in the middle of it. The navigation is now the shell's job;
 * the empty day is now one line and an action.
 */
export default function DashboardScreen() {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const format = useFormat();
  const { business, professional } = useRequiredWorkspace();
  const timezone = business.timezone;

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

  // What the professional has and has not done yet.
  const services = useAsyncData(() => fetchServices(business.id), [business.id]);
  const schedule = useAsyncData(
    () => (professional ? fetchWeeklySchedule(professional.id) : Promise.resolve([])),
    [professional?.id],
  );

  const setupSteps: SetupStep[] = [
    { key: 'business', done: true, href: '/app/settings' },
    { key: 'services', done: (services.data ?? []).length > 0, href: '/app/services' },
    { key: 'schedule', done: (schedule.data ?? []).length > 0, href: '/app/availability' },
    {
      key: 'review',
      done: (services.data ?? []).length > 0 && (schedule.data ?? []).length > 0,
      href: '/app/availability/preview',
    },
    { key: 'share', done: business.isPublished, href: '/app/settings' },
  ];
  const setupComplete = setupSteps.every((step) => step.done);

  const upcomingRows = upcoming.data ?? [];
  const todayRows = todays.data ?? [];
  const next = upcomingRows[0] ?? null;
  const pendingCount = upcomingRows.filter((row) => row.status === 'pending').length;

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

  return (
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      title={t('dashboard.title')}
      subtitle={format.date(new Date(), timezone)}
      action={
        <Link href="/app/appointments/new" asChild>
          <Button label={t('appointments.newAppointment')} />
        </Link>
      }
    >
      <OfflineNotice />

      {!setupComplete && <SetupChecklist steps={setupSteps} />}

      {/* 1. Who is next. */}
      <NextAppointment
        appointment={next}
        loading={upcoming.loading}
        timezone={timezone}
        format={format}
        tk={tk}
        palette={palette}
      />

      {/* 2. The numbers, each labelled with what it counts. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Stat value={todayRows.length} label={t('dashboard.statToday')} />
        <Stat
          value={upcomingRows.length}
          label={t('dashboard.statUpcoming', { days: UPCOMING_DAYS })}
          tone="accent"
        />
        <Stat
          value={pendingCount}
          label={t('dashboard.statPending')}
          tone={pendingCount > 0 ? 'warning' : 'default'}
        />
      </View>

      {/* 3. The rest of today. */}
      <Card>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.sm,
          }}
        >
          <Text variant="heading">{t('dashboard.today')}</Text>
          <Link href="/app/calendar" asChild>
            <Button label={t('dashboard.openAgenda')} variant="ghost" size="compact" />
          </Link>
        </View>

        {todays.loading && <ActivityIndicator />}

        {!todays.loading && todayRows.length === 0 && (
          <EmptyState
            mark="◷"
            title={t('dashboard.nothingToday')}
            body={t('dashboard.nothingTodayHint')}
            action={
              <Link href="/app/appointments/new" asChild>
                <Button
                  label={t('appointments.newAppointment')}
                  variant="secondary"
                  size="compact"
                />
              </Link>
            }
          />
        )}

        <View style={{ gap: spacing.sm }}>
          {todayRows.map((appointment) => (
            <AppointmentRow
              key={appointment.id}
              appointment={appointment}
              timezone={timezone}
              showDate={false}
            />
          ))}
        </View>
      </Card>

      {/* 4. The link, findable but not the point of the screen. */}
      <Card>
        <Text variant="heading">{t('dashboard.yourBookingLink')}</Text>
        <Text variant="caption" tone="muted" selectable numberOfLines={2}>
          {link}
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Button
            label={t('dashboard.shareLink')}
            variant="secondary"
            size="compact"
            onPress={share}
            style={{ flexGrow: 1 }}
          />
          <Link href={`/p/${business.slug}`} asChild>
            <Button
              label={t('dashboard.openPublicPage')}
              variant="ghost"
              size="compact"
              style={{ flexGrow: 1 }}
            />
          </Link>
        </View>

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

        <Badge
          label={business.isPublished ? t('dashboard.published') : t('dashboard.notPublished')}
          tone={business.isPublished ? 'success' : 'warning'}
          mark={business.isPublished ? '✓' : '!'}
        />
      </Card>
    </WorkspaceShell>
  );
}

/**
 * The next appointment, as something you can act on.
 *
 * It is a link to the appointment itself, which the previous card was not --
 * it showed the time and the name and then made you find the same row again
 * in a list to do anything about it.
 */
function NextAppointment({
  appointment,
  loading,
  timezone,
  format,
  tk,
  palette,
}: {
  appointment: ProfessionalAppointment | null;
  loading: boolean;
  timezone: string;
  format: ReturnType<typeof useFormat>;
  tk: ReturnType<typeof useDynamicT>;
  palette: ReturnType<typeof useTheme>['palette'];
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Card>
        <ActivityIndicator />
      </Card>
    );
  }

  if (!appointment) {
    return (
      <Card>
        <Text variant="overline" tone="muted">
          {t('dashboard.nextAppointment')}
        </Text>
        <EmptyState
          mark="—"
          title={t('dashboard.noNextAppointment')}
          body={t('dashboard.noNextAppointmentHint')}
        />
      </Card>
    );
  }

  const service = appointment.items[0];
  const badge = statusBadge(appointment.status);
  const status = tk(statusLabelKey(appointment.status));

  return (
    <PressableLink
      href={`/app/appointments/${appointment.id}`}
      accessibilityLabel={`${t('dashboard.nextAppointment')}: ${format.dateTime(
        appointment.startsAt,
        timezone,
      )}, ${appointment.customer.fullName}, ${status}`}
      style={{
        gap: spacing.sm,
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: palette.accent,
        backgroundColor: palette.surface,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
        }}
      >
        <Text variant="overline" tone="accent">
          {t('dashboard.nextAppointment')}
        </Text>
        <Badge label={status} tone={badge.tone} mark={badge.mark} />
      </View>

      {/* Wraps onto two lines rather than breaking the time in half: at 375px
          "10:00 a.m." beside "lunes, 28 de septiembre" does not fit, and the
          half that gets broken is the one that matters. */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: spacing.sm,
        }}
      >
        <Text variant="display" numberOfLines={1}>
          {format.time(appointment.startsAt, timezone)}
        </Text>
        <Text variant="body" tone="muted">
          {format.date(appointment.startsAt, timezone)}
        </Text>
      </View>

      <Text variant="heading">{appointment.customer.fullName}</Text>

      {service && (
        <Text variant="body" tone="muted">
          {service.name} {'·'} {format.duration(service.durationMinutes)}
        </Text>
      )}

      <Text variant="caption" tone="accent">
        {t('dashboard.openAppointment')} {'›'}
      </Text>
    </PressableLink>
  );
}
