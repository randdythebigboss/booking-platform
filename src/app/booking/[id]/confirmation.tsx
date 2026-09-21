import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button, Card, Feedback, Screen, Text } from '@/components/ui';
import { describeStatus, type GuestAppointment } from '@/features/booking';
import { formatDateIn, formatDuration, formatMoney, formatTimeIn } from '@/lib/format';
import { cancelAppointmentByToken, fetchAppointmentByToken } from '@/services/booking';
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

      <Card>
        <Text variant="caption" tone="muted">
          Keep this link to check or cancel your appointment. Anyone with it can manage this
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
