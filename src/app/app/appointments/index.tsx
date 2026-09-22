import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppointmentRow } from '@/components/appointment-row';
import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Screen, Select, Text } from '@/components/ui';
import { isoDateIn, zonedInstant } from '@/features/availability';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { fetchAppointments } from '@/services/appointments';
import { spacing } from '@/theme';
import type { AppointmentStatus } from '@/types/domain';

type Scope = 'today' | 'upcoming' | 'past';
type StatusFilter = AppointmentStatus | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;

const SCOPES = [
  { value: 'today' as const, label: 'Today' },
  { value: 'upcoming' as const, label: 'Upcoming' },
  { value: 'past' as const, label: 'Past' },
];

const STATUSES = [
  { value: 'all' as const, label: 'Every status' },
  { value: 'pending' as const, label: 'Pending' },
  { value: 'confirmed' as const, label: 'Confirmed' },
  { value: 'completed' as const, label: 'Completed' },
  { value: 'cancelled' as const, label: 'Cancelled' },
  { value: 'no_show' as const, label: 'No-show' },
];

export default function AppointmentsScreen() {
  const { business } = useRequiredWorkspace();
  const timezone = business.timezone;

  const [scope, setScope] = useState<Scope>('upcoming');
  const [status, setStatus] = useState<StatusFilter>('all');

  const today = isoDateIn(new Date(), timezone);
  const dayStart = zonedInstant(today, 0, timezone);

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
    <Screen title="Appointments" subtitle="Everything booked, past and future.">
      <Link href="/app/appointments/new" asChild>
        <Button label="New appointment" />
      </Link>

      <Select label="When" value={scope} options={SCOPES} onChange={setScope} maxHeight={150} />
      <Select label="Status" value={status} options={STATUSES} onChange={setStatus} maxHeight={200} />

      {appointments.loading && <ActivityIndicator />}
      {appointments.error && <Feedback tone="danger" message={appointments.error} />}

      {!appointments.loading && rows.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            Nothing here. Try another filter.
          </Text>
        </Card>
      )}

      {rows.length > 0 && (
        <Text variant="caption" tone="muted">
          {rows.length} appointment{rows.length === 1 ? '' : 's'}
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
