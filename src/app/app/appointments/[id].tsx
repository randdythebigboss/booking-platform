import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Text } from '@/components/ui';
import { availableActions, statusLabel, statusTone } from '@/features/appointments';
import { toWorkspaceError } from '@/features/workspace';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatDateIn, formatDuration, formatMoney, formatTimeIn } from '@/lib/format';
import { fetchAppointment, setAppointmentStatus } from '@/services/appointments';
import { spacing } from '@/theme';
import type { AppointmentStatus } from '@/types/domain';

export default function AppointmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { business } = useRequiredWorkspace();
  const timezone = business.timezone;

  const appointment = useAsyncData(
    () => (id ? fetchAppointment(id) : Promise.resolve(null)),
    [id],
  );

  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<AppointmentStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function apply(next: AppointmentStatus) {
    if (!id) return;
    setPending(next);
    setFailure(null);
    try {
      await setAppointmentStatus(id, next, next === 'cancelled' ? reason : undefined);
      setReason('');
      appointment.reload();
    } catch (cause) {
      setFailure(toWorkspaceError(cause).message);
    } finally {
      setPending(null);
    }
  }

  if (appointment.loading) {
    return (
      <Screen title="Appointment">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (appointment.error) {
    return (
      <Screen title="Appointment">
        <Feedback tone="danger" message={appointment.error} />
      </Screen>
    );
  }

  const row = appointment.data;
  if (!row) {
    return (
      <Screen title="Not found" subtitle="That appointment is not in this business." />
    );
  }

  const actions = availableActions(row.status, row.startsAt);

  return (
    <Screen
      title={formatTimeIn(row.startsAt, timezone)}
      subtitle={formatDateIn(row.startsAt, timezone)}
    >
      <Card>
        <Text variant="label" tone={statusTone(row.status)}>
          {statusLabel(row.status)}
        </Text>
        <Text variant="caption" tone="muted">
          {formatTimeIn(row.startsAt, timezone)} {'–'} {formatTimeIn(row.endsAt, timezone)}
          {row.professionalName ? ` · ${row.professionalName}` : ''}
        </Text>
        {row.cancellationReason && (
          <Text variant="caption" tone="danger">
            Cancelled: {row.cancellationReason}
          </Text>
        )}
      </Card>

      <Card>
        <Text variant="heading">Customer</Text>
        <Text variant="body">{row.customer.fullName}</Text>
        <Text variant="body" tone="muted" selectable>
          {row.customer.phone}
        </Text>
        {row.customer.email && (
          <Text variant="body" tone="muted" selectable>
            {row.customer.email}
          </Text>
        )}
        {row.notes && (
          <Text variant="caption" tone="muted">
            Note: {row.notes}
          </Text>
        )}
      </Card>

      <Card>
        <Text variant="heading">Service</Text>
        {row.items.length === 0 && (
          <Text variant="body" tone="muted">
            No service recorded.
          </Text>
        )}
        {row.items.map((item) => (
          <Text key={item.name} variant="body">
            {item.name} {'·'} {formatDuration(item.durationMinutes)} {'·'}{' '}
            {formatMoney(item.price, item.currency)}
          </Text>
        ))}
        <Text variant="caption" tone="muted">
          Recorded as it was when the customer booked, so later price or duration changes do not
          rewrite this.
        </Text>
      </Card>

      <Card>
        <Text variant="heading">What now?</Text>

        {actions.length === 0 && (
          <Text variant="body" tone="muted">
            {row.status === 'cancelled'
              ? 'This appointment is cancelled and its time has been released.'
              : 'This appointment is closed. Nothing left to do.'}
          </Text>
        )}

        {actions.some((action) => action.status === 'cancelled') && (
          <Field
            label="Reason (optional)"
            value={reason}
            onChangeText={setReason}
            placeholder="Customer called to cancel"
          />
        )}

        {failure && <Feedback tone="danger" message={failure} />}

        <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
          {actions.map((action) => (
            <Button
              key={action.status}
              label={action.label}
              variant={action.destructive ? 'ghost' : 'primary'}
              loading={pending === action.status}
              onPress={() => apply(action.status)}
            />
          ))}
        </View>

        {row.status === 'confirmed' && actions.length === 1 && (
          <Text variant="caption" tone="muted">
            Completed and no-show become available once the appointment has started.
          </Text>
        )}
      </Card>
    </Screen>
  );
}
