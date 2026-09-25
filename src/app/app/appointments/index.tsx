import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { AppointmentRow } from '@/components/appointment-row';
import { useRequiredWorkspace } from '@/components/providers';
import {
  Button,
  Card,
  EmptyState,
  Feedback,
  Segmented,
  Select,
  Text,
} from '@/components/ui';
import { WorkspaceShell } from '@/components/workspace-shell';
import { statusLabelKey } from '@/features/appointments';
import { isoDateIn, zonedInstant } from '@/features/availability';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useAsyncData } from '@/hooks/use-async-data';
import { useFormat } from '@/i18n/use-format';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { fetchAppointments, type ProfessionalAppointment } from '@/services/appointments';
import { spacing } from '@/theme';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '@/types/domain';

type Scope = 'today' | 'upcoming' | 'past';
type StatusFilter = AppointmentStatus | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;
const SCOPES: Scope[] = ['today', 'upcoming', 'past'];

/**
 * Every booking, filtered.
 *
 * ---------------------------------------------------------------------------
 * Why the filters live in the URL
 * ---------------------------------------------------------------------------
 *
 * Open an appointment, press Back, and the list has to be the list you left --
 * same scope, same status. Keeping that in component state loses it on every
 * navigation, so it is in the query string instead, where the browser's own
 * history restores it for free and a filtered view can be linked to.
 *
 * ---------------------------------------------------------------------------
 * What "Próximas" means
 * ---------------------------------------------------------------------------
 *
 * Bookings that are still going to happen: pending and confirmed. A cancelled
 * appointment next Tuesday is not something to prepare for, and mixing it in
 * makes the count useless -- the number on the dashboard would stop matching
 * the list. Cancelled ones are still one tap away under *Estado*, and *Pasadas*
 * keeps the whole record.
 */
export default function AppointmentsScreen() {
  const { business, professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const format = useFormat();
  const router = useRouter();
  const timezone = business.timezone;

  const params = useLocalSearchParams<{ scope?: string; status?: string }>();
  const scope: Scope = SCOPES.includes(params.scope as Scope)
    ? (params.scope as Scope)
    : 'upcoming';
  const status: StatusFilter =
    params.status === 'all' || !params.status
      ? 'all'
      : (APPOINTMENT_STATUSES as readonly string[]).includes(params.status)
        ? (params.status as AppointmentStatus)
        : 'all';

  const setFilters = (next: { scope?: Scope; status?: StatusFilter }) => {
    router.setParams({
      scope: next.scope ?? scope,
      status: next.status ?? status,
    });
  };

  const today = isoDateIn(new Date(), timezone);
  const dayStart = zonedInstant(today, 0, timezone);

  const statuses = [
    { value: 'all' as const, label: t('appointments.everyStatus') },
    ...APPOINTMENT_STATUSES.map((value) => ({ value, label: tk(statusLabelKey(value)) })),
  ];

  const range =
    scope === 'today'
      ? { from: dayStart, to: new Date(dayStart.getTime() + DAY_MS), ascending: true }
      : scope === 'upcoming'
        ? { from: dayStart, to: new Date(dayStart.getTime() + 90 * DAY_MS), ascending: true }
        : { from: new Date(dayStart.getTime() - 365 * DAY_MS), to: dayStart, ascending: false };

  // `Próximas` with no status chosen means "still happening". Choosing a
  // status explicitly always wins, so cancelled bookings stay reachable.
  const requested: AppointmentStatus[] | undefined =
    status !== 'all'
      ? [status]
      : scope === 'upcoming'
        ? ['pending', 'confirmed']
        : undefined;

  const appointments = useAsyncData(
    () =>
      fetchAppointments({
        businessId: business.id,
        from: range.from,
        to: range.to,
        ascending: range.ascending,
        statuses: requested,
      }),
    [business.id, scope, status, today],
  );

  // Stable between renders, so the grouping below is not recomputed on every
  // one of them.
  const rows = useMemo(() => appointments.data ?? [], [appointments.data]);
  useRefreshOnFocus(appointments.reload);

  // Grouped by day, so a long list has somewhere for the eye to rest.
  const groups = useMemo(() => {
    const byDay = new Map<string, ProfessionalAppointment[]>();

    for (const appointment of rows) {
      const day = isoDateIn(appointment.startsAt, timezone);
      const existing = byDay.get(day);
      if (existing) existing.push(appointment);
      else byDay.set(day, [appointment]);
    }

    return [...byDay.entries()];
  }, [rows, timezone]);

  return (
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      title={t('appointments.title')}
      action={
        <Link href="/app/appointments/new" asChild>
          <Button label={t('appointments.newAppointment')} />
        </Link>
      }
      toolbar={
        <View style={{ gap: spacing.sm }}>
          <Segmented
            label={t('appointments.when')}
            value={scope}
            onChange={(value) => setFilters({ scope: value })}
            options={[
              { value: 'today', label: t('appointments.scopeToday') },
              { value: 'upcoming', label: t('appointments.scopeUpcoming') },
              { value: 'past', label: t('appointments.scopePast') },
            ]}
          />
        </View>
      }
    >
      {/* The status filter is a real dropdown rather than a permanently open
          list: the pair of them used to push the first appointment four
          hundred pixels down the page. */}
      <Select
        label={t('appointments.status')}
        value={status}
        options={statuses}
        onChange={(value) => setFilters({ status: value })}
        maxHeight={200}
      />

      {appointments.loading && <ActivityIndicator />}
      {appointments.error && <Feedback tone="danger" message={appointments.error} />}

      {!appointments.loading && rows.length === 0 && (
        <Card>
          <EmptyState
            mark="≡"
            title={t('appointments.emptyFiltered')}
            body={
              scope === 'upcoming'
                ? t('appointments.emptyUpcomingHint')
                : t('appointments.emptyOtherHint')
            }
            action={
              scope !== 'upcoming' ? (
                <Button
                  label={t('appointments.scopeUpcoming')}
                  variant="secondary"
                  size="compact"
                  onPress={() => setFilters({ scope: 'upcoming', status: 'all' })}
                />
              ) : (
                <Link href="/app/appointments/new" asChild>
                  <Button
                    label={t('appointments.newAppointment')}
                    variant="secondary"
                    size="compact"
                  />
                </Link>
              )
            }
          />
        </Card>
      )}

      {rows.length > 0 && (
        <>
          <Text variant="caption" tone="muted">
            {t('appointments.count', { count: rows.length })}
          </Text>

          <View style={{ gap: spacing.lg }}>
            {groups.map(([day, dayRows]) => (
              <View key={day} style={{ gap: spacing.sm }}>
                {scope !== 'today' && (
                  <Text variant="overline" tone="muted">
                    {format.date(dayRows[0]!.startsAt, timezone)}
                  </Text>
                )}
                {dayRows.map((appointment) => (
                  <AppointmentRow
                    key={appointment.id}
                    appointment={appointment}
                    timezone={timezone}
                    // The group heading already carries the date.
                    showDate={false}
                  />
                ))}
              </View>
            ))}
          </View>
        </>
      )}
    </WorkspaceShell>
  );
}
