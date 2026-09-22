import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { SlotPicker } from '@/components/slot-picker';
import { Button, Card, Feedback, Field, Screen, Text, ToggleRow } from '@/components/ui';
import {
  availableActions,
  describeEvent,
  rescheduleCount,
  statusLabel,
  statusTone,
} from '@/features/appointments';
import { isoDateIn, parseClockTime, zonedInstant } from '@/features/availability';
import { toWorkspaceError } from '@/features/workspace';
import { useAsyncData } from '@/hooks/use-async-data';
import {
  formatDateIn,
  formatDateTimeIn,
  formatDuration,
  formatMoney,
  formatTimeIn,
} from '@/lib/format';
import {
  fetchAppointment,
  fetchAppointmentEvents,
  rescheduleAppointment,
  setAppointmentStatus,
} from '@/services/appointments';
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

  const history = useAsyncData(
    () => (id ? fetchAppointmentEvents(id) : Promise.resolve([])),
    [id],
  );

  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<AppointmentStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState<string | null>(null);
  const [moveSlot, setMoveSlot] = useState<string | null>(null);
  const [moveTime, setMoveTime] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [outsideHours, setOutsideHours] = useState(false);
  const [moveFailure, setMoveFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function refresh() {
    appointment.reload();
    history.reload();
  }

  async function apply(next: AppointmentStatus) {
    if (!id) return;
    setPending(next);
    setFailure(null);
    try {
      await setAppointmentStatus(id, next, next === 'cancelled' ? reason : undefined);
      setReason('');
      refresh();
    } catch (cause) {
      setFailure(toWorkspaceError(cause).message);
    } finally {
      setPending(null);
    }
  }

  async function move() {
    if (!id || !moveDate) return;
    setSaving(true);
    setMoveFailure(null);

    try {
      // A slot from the list is an instant already. A typed time is wall clock
      // in the business timezone, which is the only way to say "quarter past
      // ten here" without the device's own timezone getting involved.
      let startsAt: Date;
      if (moveSlot) {
        startsAt = new Date(moveSlot);
      } else if (moveTime.trim()) {
        startsAt = zonedInstant(moveDate, parseClockTime(moveTime.trim()), timezone);
      } else {
        setMoveFailure('Pick a time from the list, or type one.');
        return;
      }

      await rescheduleAppointment({
        appointmentId: id,
        startsAt,
        reason: moveReason.trim() || undefined,
        allowOutsideHours: outsideHours,
      });

      setMoving(false);
      setMoveSlot(null);
      setMoveTime('');
      setMoveReason('');
      setOutsideHours(false);
      refresh();
    } catch (cause) {
      setMoveFailure(
        cause instanceof Error && cause.name === 'InvalidTimeValueError'
          ? 'Use a 24-hour time like 14:30.'
          : toWorkspaceError(cause).message,
      );
    } finally {
      setSaving(false);
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
  const canMove = row.status === 'pending' || row.status === 'confirmed';
  const serviceId = row.items[0]?.serviceId ?? null;
  const events = history.data ?? [];
  const moved = rescheduleCount(events);

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
        {moved > 0 && (
          <Text variant="caption" tone="muted">
            {moved === 1 ? 'Moved once already.' : `Moved ${moved} times already.`}
          </Text>
        )}
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

      {canMove && (
        <Card>
          <Text variant="heading">Move it</Text>

          {!moving && (
            <>
              <Text variant="body" tone="muted">
                The appointment keeps its identity, its customer and its history. It only moves
                if the new time is free.
              </Text>
              <Button
                label="Reschedule"
                variant="secondary"
                onPress={() => {
                  setMoveDate(isoDateIn(row.startsAt, timezone));
                  setMoveFailure(null);
                  setMoving(true);
                }}
              />
            </>
          )}

          {moving && moveDate && (
            <View style={{ gap: spacing.md }}>
              {serviceId ? (
                <SlotPicker
                  professionalId={row.professionalId}
                  serviceId={serviceId}
                  timezone={timezone}
                  date={moveDate}
                  onDateChange={(next) => {
                    setMoveDate(next);
                    setMoveSlot(null);
                  }}
                  selected={moveSlot}
                  onSelect={(iso) => {
                    setMoveSlot(iso);
                    setMoveTime('');
                  }}
                />
              ) : (
                <Feedback
                  tone="muted"
                  message="No service is recorded on this appointment, so there are no suggested times. Type one instead."
                />
              )}

              <Field
                label="Or type a time"
                value={moveTime}
                onChangeText={(value) => {
                  setMoveTime(value);
                  if (value) setMoveSlot(null);
                }}
                placeholder="14:30"
                autoCapitalize="none"
                hint="For squeezing somebody in between the published times."
              />

              <ToggleRow
                label="Allow a time outside my working hours"
                description="Your public page still only offers your normal hours."
                value={outsideHours}
                onChange={setOutsideHours}
              />

              <Field
                label="Why (optional)"
                value={moveReason}
                onChangeText={setMoveReason}
                placeholder="Customer asked for later"
              />

              {moveFailure && <Feedback tone="danger" message={moveFailure} />}

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button
                  label="Move it"
                  style={{ flex: 1 }}
                  loading={saving}
                  onPress={move}
                />
                <Button
                  label="Keep it"
                  variant="ghost"
                  style={{ flex: 1 }}
                  onPress={() => {
                    setMoving(false);
                    setMoveFailure(null);
                  }}
                />
              </View>
            </View>
          )}
        </Card>
      )}

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

      <Card>
        <Text variant="heading">History</Text>
        {history.loading && <ActivityIndicator />}
        {events.length === 0 && !history.loading && (
          <Text variant="body" tone="muted">
            Nothing recorded yet.
          </Text>
        )}
        <View style={{ gap: spacing.sm }}>
          {events.map((event) => (
            <View key={event.id} style={{ gap: 2 }}>
              <Text variant="body">
                {describeEvent(event, (at) => formatDateTimeIn(at, timezone))}
              </Text>
              <Text variant="caption" tone="muted">
                {formatDateIn(event.occurredAt, timezone)} {'·'}{' '}
                {formatTimeIn(event.occurredAt, timezone)}
                {event.reason ? ` · ${event.reason}` : ''}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="caption" tone="muted">
          This log cannot be edited or deleted, by anyone.
        </Text>
      </Card>
    </Screen>
  );
}
