import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { AppointmentRow } from '@/components/appointment-row';
import { useRequiredWorkspace } from '@/components/providers';
import { Badge, Button, Card, EmptyState, Feedback, Segmented, Text } from '@/components/ui';
import { WeekGrid } from '@/components/week-grid';
import { WeekStrip } from '@/components/week-strip';
import { useIsDesktop } from '@/components/workspace-nav';
import { WorkspaceShell } from '@/components/workspace-shell';
import { addDays, isoDateIn, parseIsoDate, zonedInstant } from '@/features/availability';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { useFormat } from '@/i18n/use-format';
import { fetchAppointments } from '@/services/appointments';
import {
  fetchBlockedTimes,
  fetchDateExceptions,
  fetchWeeklySchedule,
} from '@/services/schedule-admin';
import { radius, spacing, useTheme } from '@/theme';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Monday on or before a date. */
function startOfWeek(date: string): string {
  const { year, month, day } = parseIsoDate(date);
  // getUTCDay is Sunday-first; the week here starts on Monday.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/**
 * The professional's own calendar.
 *
 * ---------------------------------------------------------------------------
 * Two views, because two screens
 * ---------------------------------------------------------------------------
 *
 * On a desk there is room for the week as a week: a time axis, the working
 * hours as the canvas, and the appointments sitting on it. That answers the
 * question a list cannot -- *where are my gaps* -- because a gap has no row in
 * a list, and it was the whole complaint about the screen this replaces.
 *
 * On a phone seven columns is forty-five pixels each, which fits neither a
 * time nor a name. So the phone keeps a day at a time with the week strip
 * above it. Both views share one week, one selected day and one set of data,
 * so a tablet switching between them is continuous.
 */
export default function CalendarScreen() {
  const { business, professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const router = useRouter();
  const format = useFormat();
  const isDesktop = useIsDesktop();
  const timezone = business.timezone;
  const professionalId = professional?.id ?? null;

  const today = isoDateIn(new Date(), timezone);
  const [date, setDate] = useState(today);
  const [view, setView] = useState<'week' | 'day'>('week');
  const weekStart = startOfWeek(date);

  const dayStart = zonedInstant(date, 0, timezone);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

  const day = useAsyncData(
    () => fetchAppointments({ businessId: business.id, from: dayStart, to: dayEnd }),
    [business.id, date],
  );

  // One query covers the week the grid draws and the fortnight around it.
  const around = useAsyncData(
    () =>
      fetchAppointments({
        businessId: business.id,
        from: zonedInstant(addDays(weekStart, -7), 0, timezone),
        to: zonedInstant(addDays(weekStart, 21), 0, timezone),
        limit: 300,
      }),
    [business.id, weekStart],
  );

  // What shapes the week: the recurring rules, the days that break them, and
  // the time taken out by hand. Read-only here; Horario is where they change.
  const rules = useAsyncData(
    () => (professionalId ? fetchWeeklySchedule(professionalId) : Promise.resolve([])),
    [professionalId],
  );
  const exceptions = useAsyncData(
    () =>
      professionalId
        ? fetchDateExceptions(professionalId, weekStart, addDays(weekStart, 6))
        : Promise.resolve([]),
    [professionalId, weekStart],
  );
  const blocks = useAsyncData(
    () =>
      professionalId
        ? fetchBlockedTimes(
            professionalId,
            zonedInstant(weekStart, 0, timezone),
            zonedInstant(addDays(weekStart, 7), 0, timezone),
          )
        : Promise.resolve([]),
    [professionalId, weekStart],
  );

  useRefreshOnFocus(day.reload);
  useRefreshOnFocus(around.reload);

  const aroundRows = around.data ?? [];
  const busyDays = new Set(
    aroundRows
      .filter((row) => row.status !== 'cancelled')
      .map((row) => isoDateIn(row.startsAt, timezone)),
  );

  const rows = day.data ?? [];
  const active = rows.filter((row) => row.status !== 'cancelled');
  const cancelled = rows.filter((row) => row.status === 'cancelled');

  const asDate = (iso: string) => {
    const { year, month, day: d } = parseIsoDate(iso);
    return new Date(Date.UTC(year, month - 1, d, 12));
  };

  const first = asDate(weekStart);
  const last = asDate(addDays(weekStart, 6));
  const weekHeading =
    first.getUTCMonth() === last.getUTCMonth()
      ? format.monthAndYear(first)
      : `${format.monthOnly(first)} – ${format.monthAndYear(last)}`;

  const showGrid = isDesktop && view === 'week';

  return (
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      title={t('calendar.title')}
      subtitle={t('common.timesShownIn', { timezone: timezone.replace(/_/g, ' ') })}
      action={
        <Link href="/app/appointments/new" asChild>
          <Button label={t('appointments.newAppointment')} />
        </Link>
      }
      toolbar={
        <View style={{ gap: spacing.sm }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: spacing.sm,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Button
                label="‹"
                accessibilityLabel={t('common.previousWeek')}
                variant="ghost"
                size="compact"
                onPress={() => setDate(addDays(date, -7))}
              />
              <Button
                label="›"
                accessibilityLabel={t('common.nextWeek')}
                variant="ghost"
                size="compact"
                onPress={() => setDate(addDays(date, 7))}
              />
              <Button
                label={t('common.today')}
                variant={date === today ? 'ghost' : 'secondary'}
                size="compact"
                disabled={date === today}
                onPress={() => setDate(today)}
              />
            </View>

            <Text variant="label" style={{ flex: 1, minWidth: 120 }} numberOfLines={1}>
              {weekHeading}
            </Text>

            {isDesktop && (
              <Segmented
                label={t('calendar.view')}
                value={view}
                onChange={setView}
                options={[
                  { value: 'week' as const, label: t('calendar.viewWeek') },
                  { value: 'day' as const, label: t('calendar.viewDay') },
                ]}
              />
            )}
          </View>

          {!showGrid && (
            <WeekStrip
              label={t('common.chooseADay')}
              value={date}
              onChange={setDate}
              today={today}
              isEmpty={(candidate) => !busyDays.has(candidate)}
            />
          )}
        </View>
      }
    >
      {showGrid ? (
        <Card style={{ paddingHorizontal: spacing.sm }}>
          {(around.loading || rules.loading) && <ActivityIndicator />}
          {around.error && <Feedback tone="danger" message={around.error} />}
          <WeekGrid
            weekStart={weekStart}
            timezone={timezone}
            today={today}
            selected={date}
            onSelectDay={setDate}
            appointments={aroundRows}
            rules={rules.data ?? []}
            exceptions={exceptions.data ?? []}
            blocks={blocks.data ?? []}
            onOpenAppointment={(id) => router.push(`/app/appointments/${id}`)}
          />
          <Legend />
        </Card>
      ) : (
        <Card>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.sm,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">{format.date(asDate(date), 'UTC')}</Text>
              <Text variant="caption" tone="muted">
                {t('calendar.appointmentsThatDay', { count: active.length })}
              </Text>
            </View>
            {date === today && <Badge label={t('common.today')} tone="accent" mark="•" />}
          </View>

          {day.loading && <ActivityIndicator />}
          {day.error && <Feedback tone="danger" message={day.error} />}

          {!day.loading && rows.length === 0 && (
            <EmptyState
              mark="◷"
              title={t('calendar.nothingThatDay')}
              body={t('calendar.nothingThatDayHint')}
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
            {active.map((appointment) => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                timezone={timezone}
                showDate={false}
              />
            ))}
          </View>

          {/* Cancelled bookings for the day, kept but set apart: they are not
              work to do, and mixing them in makes the day look busier than it
              is. The grid leaves them out entirely, because that time is free
              again and drawing it as taken would be a lie. */}
          {cancelled.length > 0 && (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <Text variant="overline" tone="muted">
                {t('calendar.cancelledThatDay', { count: cancelled.length })}
              </Text>
              {cancelled.map((appointment) => (
                <AppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  timezone={timezone}
                  showDate={false}
                />
              ))}
            </View>
          )}
        </Card>
      )}

      {/* The way from "my week looks wrong" to the screen that fixes it. */}
      <Card>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.md,
            flexWrap: 'wrap',
          }}
        >
          <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
            <Text variant="label">{t('calendar.shapedBy')}</Text>
            <Text variant="caption" tone="muted">
              {t('calendar.shapedByHint')}
            </Text>
          </View>
          <Link href="/app/availability" asChild>
            <Button label={t('nav.availability')} variant="secondary" size="compact" />
          </Link>
        </View>
      </Card>
    </WorkspaceShell>
  );
}

/** What the bands and blocks mean, since shading alone never carries meaning. */
function Legend() {
  const { palette } = useTheme();
  const { t } = useTranslation();

  const entries = [
    {
      key: 'open',
      text: t('calendar.legendWorking'),
      style: { backgroundColor: palette.surface, borderColor: palette.borderSubtle },
    },
    {
      key: 'booked',
      text: t('calendar.legendBooked'),
      style: { backgroundColor: palette.accentMuted, borderColor: palette.accent },
    },
    {
      key: 'pending',
      text: t('appointments.status_pending'),
      style: { backgroundColor: palette.warningMuted, borderColor: palette.warning },
    },
    {
      key: 'blocked',
      text: t('calendar.legendBlocked'),
      style: {
        backgroundColor: palette.surfaceMuted,
        borderColor: palette.border,
        borderStyle: 'dashed' as const,
      },
    },
  ];

  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs }}
    >
      {entries.map((entry) => (
        <View
          key={entry.key}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
        >
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: radius.sm,
              borderWidth: 1,
              ...entry.style,
            }}
          />
          <Text variant="caption" tone="muted">
            {entry.text}
          </Text>
        </View>
      ))}
    </View>
  );
}
