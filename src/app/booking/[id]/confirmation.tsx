import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { SlotPicker } from '@/components/slot-picker';
import { Button, Card, Feedback, Screen, Text } from '@/components/ui';
import { isoDateIn } from '@/features/availability';
import { describeStatus, toBookingError, type GuestAppointment } from '@/features/booking';
import { formatDateIn, formatDuration, formatMoney, formatTimeIn } from '@/lib/format';
import {
  cancelAppointmentByToken,
  fetchAppointmentByToken,
  rescheduleAppointmentByToken,
} from '@/services/booking';
import { spacing } from '@/theme';

type State =
  | { kind: 'loading' }
  | { kind: 'no-token' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; appointment: GuestAppointment };

/**
 * A guest's view of their own appointment.
 *
 * Access is the token issued at booking time, nothing else. Guessing an
 * appointment id gets you nothing, and the backend only ever returns the one
 * appointment the token belongs to.
 */
export default function ConfirmationScreen() {
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [cancelling, setCancelling] = useState(false);
  const [nonce, setNonce] = useState(0);

  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState<string | null>(null);
  const [moveSlot, setMoveSlot] = useState<string | null>(null);
  const [moveFailure, setMoveFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    if (!token) {
      setState({ kind: 'no-token' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });

    fetchAppointmentByToken(id, token)
      .then((appointment) => {
        if (!cancelled) setState({ kind: 'ready', appointment });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : '';
        setState(
          /could not find/i.test(message)
            ? { kind: 'not-found' }
            : { kind: 'error', message: 'We could not load this booking. Please try again.' },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [id, token, nonce]);

  if (state.kind === 'loading') {
    return (
      <Screen title="Your appointment">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (state.kind === 'no-token') {
    return (
      <Screen title="Your appointment">
        <Card>
          <Text variant="body" tone="muted">
            This page needs the personal link you were given when you booked. Open that link again
            to see your appointment.
          </Text>
        </Card>
      </Screen>
    );
  }

  if (state.kind === 'not-found') {
    return (
      <Screen title="Not found">
        <Card>
          <Text variant="body" tone="muted">
            We could not find that booking. The link may be wrong, or the appointment may have been
            removed.
          </Text>
        </Card>
      </Screen>
    );
  }

  if (state.kind === 'error') {
    return (
      <Screen title="Your appointment">
        <Feedback tone="danger" message={state.message} />
      </Screen>
    );
  }

  const { appointment } = state;
  const cancelled = appointment.status === 'cancelled';

  async function move() {
    if (!moveSlot) {
      setMoveFailure('Choose a new time first.');
      return;
    }

    setSaving(true);
    setMoveFailure(null);
    try {
      await rescheduleAppointmentByToken(id as string, token as string, new Date(moveSlot));
      setMoving(false);
      setMoveSlot(null);
      // Re-read rather than patch: if the move lost a race, the appointment is
      // still where it was, and the page should say so.
      setNonce((value) => value + 1);
    } catch (cause) {
      setMoveFailure(toBookingError(cause).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen
      title={cancelled ? 'Appointment cancelled' : 'You are booked'}
      subtitle={`${appointment.businessName} · ${appointment.professionalName}`}
    >
      <Card>
        <Text variant="label" tone={cancelled ? 'danger' : 'success'}>
          {describeStatus(appointment.status)}
        </Text>
        <Text variant="title">{formatTimeIn(appointment.startsAt, appointment.timezone)}</Text>
        <Text variant="body">{formatDateIn(appointment.startsAt, appointment.timezone)}</Text>
        <Text variant="caption" tone="muted">
          Times shown in {appointment.timezone.replace(/_/g, ' ')}.
        </Text>

        <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
          {appointment.items.map((item) => (
            <Text key={item.name} variant="body">
              {item.name} {'·'} {formatDuration(item.durationMinutes)} {'·'}{' '}
              {formatMoney(item.price, item.currency)}
            </Text>
          ))}
        </View>

        <Text variant="caption" tone="muted">
          Booked for {appointment.customerName}
        </Text>
      </Card>

      {(appointment.businessAddress || appointment.businessPhone) && (
        <Card>
          <Text variant="heading">Where to go</Text>
          {appointment.businessAddress && (
            <Text variant="body">{appointment.businessAddress}</Text>
          )}
          {appointment.businessPhone && (
            <Text variant="body" tone="muted" selectable>
              {appointment.businessPhone}
            </Text>
          )}
        </Card>
      )}

      {appointment.canReschedule && appointment.serviceId && (
        <Card>
          <Text variant="heading">Need a different time?</Text>

          {!moving && (
            <>
              <Text variant="body" tone="muted">
                Pick another time and we will move this appointment. Your booking stays the same
                otherwise, and you keep this link.
              </Text>
              <Button
                label="Reschedule"
                variant="secondary"
                onPress={() => {
                  setMoveDate(isoDateIn(appointment.startsAt, appointment.timezone));
                  setMoveFailure(null);
                  setMoving(true);
                }}
              />
            </>
          )}

          {moving && moveDate && (
            <View style={{ gap: spacing.md }}>
              <SlotPicker
                professionalId={appointment.professionalId}
                serviceId={appointment.serviceId}
                timezone={appointment.timezone}
                date={moveDate}
                onDateChange={(next) => {
                  setMoveDate(next);
                  setMoveSlot(null);
                }}
                selected={moveSlot}
                onSelect={setMoveSlot}
              />

              {moveFailure && <Feedback tone="danger" message={moveFailure} />}

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button
                  label="Move my appointment"
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
        <Text variant="caption" tone="muted">
          Keep this link to check, move or cancel your appointment. Anyone with it can manage this
          booking, so treat it like a ticket.
        </Text>
      </Card>

      {appointment.canCancel && (
        <Button
          label="Cancel this appointment"
          variant="ghost"
          loading={cancelling}
          onPress={async () => {
            setCancelling(true);
            try {
              await cancelAppointmentByToken(id as string, token as string);
              setNonce((value) => value + 1);
            } finally {
              setCancelling(false);
            }
          }}
        />
      )}

      <Link href={`/p/${appointment.businessSlug}`} asChild>
        <Button label="Back to the booking page" variant="secondary" />
      </Link>
    </Screen>
  );
}
