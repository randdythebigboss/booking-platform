import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { SlotPicker } from '@/components/slot-picker';
import { Button, Card, Feedback, Screen, Text } from '@/components/ui';
import { isoDateIn } from '@/features/availability';
import { guestStatusKey, toBookingError, type GuestAppointment } from '@/features/booking';
import { useBookingErrorText } from '@/i18n/use-error-text';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
import { AzulPlaceholder } from '@/components/azul-placeholder';
import { useSession } from '@/components/providers';
import { MessageThread } from '@/components/message-thread';
import { useGuestToken } from '@/hooks/use-guest-token';
import {
  cancelAppointmentByToken,
  fetchAppointmentByToken,
  rescheduleAppointmentByToken,
} from '@/services/booking';
import {
  fetchPaymentByToken,
  retryPayment,
  simulatePayment,
  type GuestPaymentSummary,
} from '@/services/payments';
import { radius, spacing, useTheme } from '@/theme';
import {
  fetchMessagesByToken,
  markMessagesReadByToken,
  sendMessageByToken,
  type AppointmentMessage,
} from '@/services/messages';
import { claimAppointment } from '@/services/customer-account';

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useGuestToken();
  const session = useSession();
  const [claim, setClaim] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  // The conversation about this appointment. A guest has no account, so the
  // booking link is the only thing that proves who they are -- the same
  // credential that already lets them move and cancel it.
  const [messages, setMessages] = useState<AppointmentMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);

  const loadMessages = useCallback(async () => {
    if (!id || !token) return;
    setMessagesLoading(true);
    try {
      setMessages(await fetchMessagesByToken({ appointmentId: id, accessToken: token }));
      // Opening the page is reading them. Not awaited: an unread badge that
      // clears a moment later is not worth delaying the conversation for.
      void markMessagesReadByToken({ appointmentId: id, accessToken: token }).catch(() => {});
    } catch {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);
  const { t } = useTranslation();
  const { palette } = useTheme();
  const format = useFormat();
  const tk = useDynamicT();
  const errorText = useBookingErrorText();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [cancelling, setCancelling] = useState(false);
  const [nonce, setNonce] = useState(0);

  // The money, read separately from the appointment: a booking that owes
  // nothing is the common case, and it should not pay for a second query
  // being slow.
  const [payment, setPayment] = useState<GuestPaymentSummary | null>(null);
  const [paying, setPaying] = useState(false);
  const [payFailure, setPayFailure] = useState<string | null>(null);

  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState<string | null>(null);
  const [moveSlot, setMoveSlot] = useState<string | null>(null);
  const [moveFailure, setMoveFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [slotsNonce, setSlotsNonce] = useState(0);

  useEffect(() => {
    if (!id) return;
    // null means the fragment has not been read yet; '' means it is absent.
    if (token === null) return;
    if (token === '') {
      setState({ kind: 'no-token' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });

    fetchPaymentByToken(id, token)
      .then((summary) => {
        if (!cancelled) setPayment(summary);
      })
      .catch(() => {
        // A booking is readable whether or not its payment is. Failing to load
        // the money must not take the appointment down with it.
        if (!cancelled) setPayment(null);
      });

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
  // Completed and no-show are over, not upcoming: the page should not greet
  // somebody with "you are booked" for an appointment that already closed.
  const closed = appointment.status === 'completed' || appointment.status === 'no_show';

  /**
   * Puts a simulated outcome through, and re-reads what the server decided.
   *
   * The key is derived from the payment and the scenario, so a double-pressed
   * button is one outcome rather than two.
   */
  async function pay(scenario: 'success' | 'decline') {
    if (!id || !token || !payment?.paymentId) return;

    setPaying(true);
    setPayFailure(null);
    try {
      await simulatePayment(id, token, scenario, `ui:${payment.paymentId}:${scenario}`);
      setNonce((value) => value + 1);
    } catch (cause) {
      setPayFailure(errorText(cause));
    } finally {
      setPaying(false);
    }
  }

  /** After a decline: a new attempt, for the same amount. */
  async function tryAgain() {
    if (!id || !token) return;

    setPaying(true);
    setPayFailure(null);
    try {
      await retryPayment(id, token);
      setNonce((value) => value + 1);
    } catch (cause) {
      setPayFailure(errorText(cause));
    } finally {
      setPaying(false);
    }
  }

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
      title={
        cancelled
          ? t('confirmation.cancelledTitle')
          : closed
            ? t('confirmation.yourAppointment')
            : t('confirmation.booked')
      }
      subtitle={`${appointment.businessName} · ${appointment.professionalName}`}
    >
      {/* The first thing on the page answers the only question somebody has
          arriving here: did it work, and when am I expected? A status word in
          small type above a time did not, so the time is the headline and the
          outcome carries a mark as well as a colour. */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: cancelled
                ? palette.dangerMuted
                : closed
                  ? palette.surfaceMuted
                  : palette.successMuted,
            }}
          >
            <Text
              variant="heading"
              style={{
                color: cancelled ? palette.danger : closed ? palette.textMuted : palette.success,
              }}
            >
              {cancelled ? '✕' : closed ? '–' : '✓'}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" tone={cancelled ? 'danger' : closed ? 'muted' : 'success'}>
              {tk(guestStatusKey(appointment.status))}
            </Text>
            <Text variant="title">{format.time(appointment.startsAt, appointment.timezone)}</Text>
            <Text variant="body" tone="muted">
              {format.date(appointment.startsAt, appointment.timezone)}
            </Text>
          </View>
        </View>

        <View
          style={{
            gap: spacing.xs,
            marginTop: spacing.sm,
            paddingTop: spacing.sm,
            borderTopWidth: 1,
            borderTopColor: palette.borderSubtle,
          }}
        >
          {appointment.items.map((item) => (
            <Text key={item.name} variant="body">
              {item.name} {'·'} {format.duration(item.durationMinutes)} {'·'}{' '}
              {format.money(item.price, item.currency)}
            </Text>
          ))}
          <Text variant="caption" tone="muted">
            {t('confirmation.bookedFor', { name: appointment.customerName })}
          </Text>
          <Text variant="caption" tone="muted">
            {t('common.timesShownIn', { timezone: appointment.timezone.replace(/_/g, ' ') })}
          </Text>
        </View>
      </Card>

      {payment?.required && payment.status && (
        <Card>
          <Text variant="heading">{t('payments.title')}</Text>

          <Text variant="label" tone={payment.status === 'paid' ? 'success' : 'muted'}>
            {tk(`payments.status.${payment.status}`)}
          </Text>

          <Text variant="body">
            {t('payments.dueNow')}: {format.money(payment.amount ?? '0', payment.currency ?? '')}
          </Text>

          {payment.remaining && Number(payment.remaining) > 0 && (
            <Text variant="caption" tone="muted">
              {t('payments.remaining')}: {format.money(payment.remaining, payment.currency ?? '')}
            </Text>
          )}

          {payment.status === 'paid' && (
            <Text variant="caption" tone="success">
              {payment.simulationEnabled ? t('payments.demoCompleted') : t('payments.paidThanks')}
            </Text>
          )}

          {payment.status === 'failed' && (
            <Text variant="caption" tone="danger">
              {t('payments.declined')}
            </Text>
          )}

          {payment.holdExpiresAt && payment.status !== 'paid' && (
            <Text variant="caption" tone="muted">
              {t('payments.holdUntil', {
                time: format.time(payment.holdExpiresAt, appointment.timezone),
              })}
            </Text>
          )}

          {payFailure && <Feedback tone="danger" message={payFailure} />}

          {/* Where paying by card will go. It does not go there yet, and
              pressing it says so rather than pretending. */}
          {payment.status !== 'paid' && <AzulPlaceholder compact />}

          {/* Development only, and the server says so: the same switch that
              decides whether a simulated outcome is accepted decides whether
              these are drawn. A production deployment leaves it off and these
              never exist. */}
          {payment.simulationEnabled && (
            <>
              {/* Unmistakable, and said before the button rather than after:
                  nobody should press Pay without knowing which kind of money
                  this is. */}
              <Text variant="label" tone="accent">
                {t('payments.demoNotice')}
              </Text>

              {(payment.status === 'pending' || payment.status === 'requires_action') && (
                <>
                  <Button
                    label={
                      payment.requirement === 'deposit'
                        ? t('payments.payDeposit', {
                            amount: format.money(payment.amount ?? '0', payment.currency ?? ''),
                          })
                        : t('payments.payFull', {
                            amount: format.money(payment.amount ?? '0', payment.currency ?? ''),
                          })
                    }
                    loading={paying}
                    onPress={() => pay('success')}
                  />
                  <Button
                    variant="ghost"
                    label={t('payments.simulateDecline')}
                    onPress={() => pay('decline')}
                  />
                </>
              )}

              {payment.status === 'failed' && (
                <Button label={t('payments.payAgain')} loading={paying} onPress={tryAgain} />
              )}
            </>
          )}
        </Card>
      )}

      {(appointment.businessAddress || appointment.businessPhone) && (
        <Card>
          <Text variant="heading">{t('publicPage.whereToGo')}</Text>
          {appointment.businessAddress && <Text variant="body">{appointment.businessAddress}</Text>}
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

      {token && session.status === 'signed-in' && (
        <Card>
          <Text variant="body" tone="muted">
            {claim === 'saved' ? t('account.saved') : t('account.saveThisBooking')}
          </Text>
          {claim === 'failed' && <Feedback tone="danger" message={t('account.couldNotSave')} />}
          {claim !== 'saved' && (
            <Button
              label={t('account.saveThisBooking')}
              variant="secondary"
              loading={claim === 'saving'}
              onPress={async () => {
                setClaim('saving');
                try {
                  const ok = await claimAppointment({
                    appointmentId: appointment.appointmentId,
                    accessToken: token,
                  });
                  setClaim(ok ? 'saved' : 'failed');
                } catch {
                  setClaim('failed');
                }
              }}
            />
          )}
          <Link href="/account" asChild>
            <Button label={t('account.myAppointments')} variant="secondary" />
          </Link>
        </Card>
      )}

      {token && (
        <MessageThread
          messages={messages}
          loading={messagesLoading}
          viewer="customer"
          timezone={appointment.timezone}
          onSend={async (body) => {
            await sendMessageByToken({
              appointmentId: appointment.appointmentId,
              accessToken: token,
              body,
            });
            await loadMessages();
          }}
        />
      )}

      <Link href={`/p/${appointment.businessSlug}`} asChild>
        <Button label={t('confirmation.backToBookingPage')} variant="secondary" />
      </Link>
    </Screen>
  );
}
