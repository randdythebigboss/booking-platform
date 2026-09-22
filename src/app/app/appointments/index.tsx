import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { AppointmentRow } from '@/components/appointment-row';
import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Screen, Select, Text } from '@/components/ui';
import { statusLabelKey } from '@/features/appointments';
import { isoDateIn, zonedInstant } from '@/features/availability';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { fetchAppointments } from '@/services/appointments';
import { spacing } from '@/theme';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '@/types/domain';

type Scope = 'today' | 'upcoming' | 'past';
type StatusFilter = AppointmentStatus | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function AppointmentsScreen() {
  const { business } = useRequiredWorkspace();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const timezone = business.timezone;

  const [scope, setScope] = useState<Scope>('upcoming');
  const [status, setStatus] = useState<StatusFilter>('all');

  const today = isoDateIn(new Date(), timezone);
  const dayStart = zonedInstant(today, 0, timezone);

  const scopes = [
    { value: 'today' as const, label: t('appointments.scopeToday') },
    { value: 'upcoming' as const, label: t('appointments.scopeUpcoming') },
    { value: 'past' as const, label: t('appointments.scopePast') },
  ];

  // Built from the enum rather than a hand-written list, so a status added to
  // the database cannot quietly go missing from the filter.
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

  const appointments = useAsyncData(
    () =>
      fetchAppointments({
        businessId: business.id,
        from: range.from,
        to: range.to,
        ascending: range.ascending,
        statuses: status === 'all' ? undefined : [status],
      }),
    [business.id, scope, status, today],
  );

  const rows = appointments.data ?? [];

  useRefreshOnFocus(appointments.reload);

  return (
    <Screen title={t('appointments.title')} subtitle={t('appointments.subtitle')}>
      <Link href="/app/appointments/new" asChild>
        <Button label={t('appointments.newAppointment')} />
      </Link>

      <Select
        label={t('appointments.when')}
        value={scope}
        options={scopes}
        onChange={setScope}
        maxHeight={150}
      />
      <Select
        label={t('appointments.status')}
        value={status}
        options={statuses}
        onChange={setStatus}
        maxHeight={200}
      />

      {appointments.loading && <ActivityIndicator />}
      {appointments.error && <Feedback tone="danger" message={appointments.error} />}

      {!appointments.loading && rows.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            {t('appointments.emptyFiltered')}
          </Text>
        </Card>
      )}

      {rows.length > 0 && (
        <Text variant="caption" tone="muted">
          {t('appointments.count', { count: rows.length })}
        </Text>
      )}

      <View style={{ gap: spacing.sm }}>
        {rows.map((appointment) => (
          <AppointmentRow
            key={appointment.id}
            appointment={appointment}
            timezone={timezone}
            showDate={scope !== 'today'}
          />
        ))}
      </View>
    </Screen>
  );
}
