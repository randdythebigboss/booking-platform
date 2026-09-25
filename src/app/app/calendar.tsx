import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { AppointmentRow } from '@/components/appointment-row';
import { useRequiredWorkspace } from '@/components/providers';
import { Badge, Button, Card, EmptyState, Feedback, Text } from '@/components/ui';
import { WeekStrip } from '@/components/week-strip';
import { WorkspaceShell } from '@/components/workspace-shell';
import { addDays, isoDateIn, parseIsoDate, zonedInstant } from '@/features/availability';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { useFormat } from '@/i18n/use-format';
import { fetchAppointments } from '@/services/appointments';
import { spacing } from '@/theme';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One day at a time, with a week of context around it.
 *
 * Deliberately not a drag-and-drop grid. What a professional needs from a
 * calendar on a phone is "what is on today, and what about Thursday" -- and
 * a week grid on a 375px screen answers neither without pinching.
 *
 * The day being looked at and today are drawn as different things; see
 * WeekStrip for why that is worth its own component.
 */
export default function CalendarScreen() {
  const { business, professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const format = useFormat();
  const timezone = business.timezone;

  const today = isoDateIn(new Date(), timezone);
  const [date, setDate] = useState(today);

  const dayStart = zonedInstant(date, 0, timezone);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

  const day = useAsyncData(
    () => fetchAppointments({ businessId: business.id, from: dayStart, to: dayEnd }),
    [business.id, date],
  );

  // The surrounding fortnight, used to mark which days in the strip are empty
  // and to fill the "coming up" list without a second trip per day.
  const around = useAsyncData(
    () =>
      fetchAppointments({
        businessId: business.id,
        from: zonedInstant(addDays(today, -7), 0, timezone),
        to: zonedInstant(addDays(today, 21), 0, timezone),
        statuses: ['pending', 'confirmed'],
        limit: 200,
      }),
    [business.id, today],
  );

  useRefreshOnFocus(day.reload);
  useRefreshOnFocus(around.reload);

  const busyDays = new Set((around.data ?? []).map((row) => isoDateIn(row.startsAt, timezone)));

  const rows = day.data ?? [];
  const active = rows.filter((row) => row.status !== 'cancelled');
  const cancelled = rows.filter((row) => row.status === 'cancelled');

  const asDate = (iso: string) => {
    const { year, month, day: d } = parseIsoDate(iso);
    return new Date(Date.UTC(year, month - 1, d, 12));
  };

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
          <WeekStrip
            label={t('common.chooseADay')}
            value={date}
            onChange={setDate}
            today={today}
            isEmpty={(candidate) => !busyDays.has(candidate)}
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.sm,
            }}
          >
            {/* Arrows, not sentences. "‹ Día anterior / Hoy / Día siguiente ›"
                needed 335px of a 320px screen, and the strip above already
                says which way is which. */}
            <Button
              label="‹"
              accessibilityLabel={t('common.previousDay')}
              variant="ghost"
              size="compact"
              onPress={() => setDate(addDays(date, -1))}
            />
            <Button
              label={t('common.today')}
              variant={date === today ? 'ghost' : 'secondary'}
              size="compact"
              disabled={date === today}
              onPress={() => setDate(today)}
            />
            <Button
              label="›"
              accessibilityLabel={t('common.nextDay')}
              variant="ghost"
              size="compact"
              onPress={() => setDate(addDays(date, 1))}
            />
          </View>
        </View>
      }
    >
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
            is. */}
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

      <Card>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.sm,
          }}
        >
          <Text variant="heading">{t('calendar.comingUp')}</Text>
          <Link href="/app/appointments?scope=upcoming" asChild>
            <Button label={t('calendar.seeAll')} variant="ghost" size="compact" />
          </Link>
        </View>

        {around.loading && <ActivityIndicator />}

        {(() => {
          const now = Date.now();
          const next = (around.data ?? [])
            .filter((row) => row.startsAt.getTime() >= now)
            .slice(0, 8);

          if (!around.loading && next.length === 0) {
            return <EmptyState mark="—" title={t('calendar.nothingComingUp')} />;
          }

          return (
            <View style={{ gap: spacing.sm }}>
              {next.map((appointment) => (
                <AppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  timezone={timezone}
                />
              ))}
            </View>
          );
        })()}
      </Card>
    </WorkspaceShell>
  );
}
