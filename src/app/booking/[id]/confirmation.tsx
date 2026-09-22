import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { LanguageSwitcher } from '@/components/language-switcher';
import { SlotPicker } from '@/components/slot-picker';
import { Button, Card, Feedback, Screen, Text } from '@/components/ui';
import { isoDateIn } from '@/features/availability';
import { guestStatusKey, toBookingError, type GuestAppointment } from '@/features/booking';
import { useBookingErrorText } from '@/i18n/use-error-text';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
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
  | { kind: 'error' }
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
  const { t } = useTranslation();
  const format = useFormat();
  const tk = useDynamicT();
  const errorText = useBookingErrorText();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [cancelling, setCancelling] = useState(false);
  const [nonce, setNonce] = useState(0);

  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState<string | null>(null);
  const [moveSlot, setMoveSlot] = useState<string | null>(null);
  const [moveFailure, setMoveFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [slotsNonce, setSlotsNonce] = useState(0);

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
        // The code, not the words: this has to work the same in both
        // languages, and matching on prose would silently stop working when
        // the interface was translated.
        setState(
          toBookingError(cause).code === 'APPOINTMENT_NOT_FOUND'
            ? { kind: 'not-found' }
            : { kind: 'error' },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [id, token, nonce]);

  if (state.kind === 'loading') {
    return (
      <Screen title={t('confirmation.yourAppointment')}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (state.kind === 'no-token') {
    return (
      <Screen title={t('confirmation.yourAppointment')}>
        <Card>
          <Text variant="body" tone="muted">
            {t('confirmation.needTheLink')} {t('confirmation.needTheLinkBody')}
          </Text>
        </Card>
        <Card>
          <LanguageSwitcher />
        </Card>
      </Screen>
    );
  }

  if (state.kind === 'not-found') {
    return (
      <Screen title={t('common.notFound')}>
        <Card>
          <Text variant="body" tone="muted">
            {t('confirmation.notFoundBody')}
          </Text>
        </Card>
        <Card>
          <LanguageSwitcher />
        </Card>
      </Screen>
    );
  }

  if (state.kind === 'error') {
    return (
      <Screen title={t('confirmation.yourAppointment')}>
        <Feedback tone="danger" message={t('confirmation.couldNotLoad')} />
      </Screen>
    );
  }

  const { appointment } = state;
  const cancelled = appointment.status === 'cancelled';

  async function move() {
    if (!moveSlot) {
      setMoveFailure(t('confirmation.chooseNewTimeFirst'));
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
      const failure = toBookingError(cause);
      setMoveFailure(errorText(failure));
      // The list was drawn before somebody else took that time. Leaving it up
      // would offer the same gone slot again, and fail again.
      if (failure.isSlotConflict) {
        setMoveSlot(null);
        setSlotsNonce((value) => value + 1);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen
      title={cancelled ? t('confirmation.cancelledTitle') : t('confirmation.booked')}
      subtitle={`${appointment.businessName} · ${appointment.professionalName}`}
    >
      <Card>
        <Text variant="label" tone={cancelled ? 'danger' : 'success'}>
          {tk(guestStatusKey(appointment.status))}
        </Text>
        <Text variant="title">{format.time(appointment.startsAt, appointment.timezone)}</Text>
        <Text variant="body">{format.date(appointment.startsAt, appointment.timezone)}</Text>
        <Text variant="caption" tone="muted">
          {t('common.timesShownIn', { timezone: appointment.timezone.replace(/_/g, ' ') })}
        </Text>

        <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
          {appointment.items.map((item) => (
            <Text key={item.name} variant="body">
              {item.name} {'·'} {format.duration(item.durationMinutes)} {'·'}{' '}
              {format.money(item.price, item.currency)}
            </Text>
          ))}
        </View>

        <Text variant="caption" tone="muted">
          {t('confirmation.bookedFor', { name: appointment.customerName })}
        </Text>
      </Card>

      {(appointment.businessAddress || appointment.businessPhone) && (
        <Card>
          <Text variant="heading">{t('publicPage.whereToGo')}</Text>
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
          <Text variant="heading">{t('confirmation.needADifferentTime')}</Text>

          {!moving && (
            <>
              <Text variant="body" tone="muted">
                {t('confirmation.rescheduleIntro')}
              </Text>
              <Button
                label={t('confirmation.reschedule')}
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
                reloadKey={slotsNonce}
              />

              {moveFailure && <Feedback tone="danger" message={moveFailure} />}

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button
                  label={t('confirmation.move')}
                  style={{ flex: 1 }}
                  loading={saving}
                  onPress={move}
                />
                <Button
                  label={t('confirmation.keep')}
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
          {t('confirmation.keepThisLink')}
        </Text>
      </Card>

      <Card>
        <LanguageSwitcher />
      </Card>

      {appointment.canCancel && (
        <Button
          label={t('confirmation.cancel')}
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
        <Button label={t('confirmation.backToBookingPage')} variant="secondary" />
      </Link>
    </Screen>
  );
}
