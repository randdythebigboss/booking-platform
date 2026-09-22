import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { SlotPicker } from '@/components/slot-picker';
import { Button, Card, Feedback, Field, Screen, Text, ToggleRow } from '@/components/ui';
import {
  availableActions,
  describeEvent,
  rescheduleCount,
  statusLabelKey,
  statusTone,
} from '@/features/appointments';
import { isoDateIn, parseClockTime, zonedInstant } from '@/features/availability';
import { toWorkspaceError } from '@/features/workspace';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
import { useAsyncData } from '@/hooks/use-async-data';
import {
  fetchAppointment,
  fetchAppointmentEvents,
  rescheduleAppointment,
  setAppointmentStatus,
} from '@/services/appointments';
import { fetchAppointmentNotifications } from '@/services/notifications';
import { fetchAppointmentPayments, refundPayment } from '@/services/payments';
import { spacing } from '@/theme';
import type { AppointmentStatus } from '@/types/domain';

export default function AppointmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { business } = useRequiredWorkspace();
  const { t } = useTranslation();
  const format = useFormat();
  const tk = useDynamicT();
  const errorText = useWorkspaceErrorText();
  const timezone = business.timezone;

  const appointment = useAsyncData(
    () => (id ? fetchAppointment(id) : Promise.resolve(null)),
    [id],
  );

  const history = useAsyncData(
    () => (id ? fetchAppointmentEvents(id) : Promise.resolve([])),
    [id],
  );

  // What the customer has been, or is about to be, told. Read-only: the
  // outbox is written by the database, never from here.
  const notifications = useAsyncData(
    () => (id ? fetchAppointmentNotifications(id) : Promise.resolve([])),
    [id],
  );

  // Money, read through Row Level Security like everything else here. A
  // professional sees their own business's payments and nobody else's.
  const payments = useAsyncData(
    () => (id ? fetchAppointmentPayments(id) : Promise.resolve([])),
    [id],
  );

  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

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
  const [slotsNonce, setSlotsNonce] = useState(0);

  function refresh() {
    appointment.reload();
    history.reload();
    notifications.reload();
    payments.reload();
  }

  /**
   * Giving the money back.
   *
   * Deliberately its own button, nowhere near Cancel: cancelling an
   * appointment and refunding a payment are different decisions, and a
   * business may well make one without the other. See ADR 0023.
   */
  async function refund(paymentId: string) {
    setRefunding(true);
    setFailure(null);
    try {
      await refundPayment(paymentId, refundReason.trim() || undefined);
      setRefundReason('');
      refresh();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setRefunding(false);
    }
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
      setFailure(errorText(cause));
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
      // ten there" without the device's own timezone getting involved.
      let startsAt: Date;
      if (moveSlot) {
        startsAt = new Date(moveSlot);
      } else if (moveTime.trim()) {
        startsAt = zonedInstant(moveDate, parseClockTime(moveTime.trim()), timezone);
      } else {
        setMoveFailure(t('reschedule.pickOrType'));
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
      if (cause instanceof Error && cause.name === 'InvalidTimeValueError') {
        setMoveFailure(t('reschedule.badTime'));
        return;
      }

      const failed = toWorkspaceError(cause);
      setMoveFailure(errorText(failed));
      // The list was drawn before somebody took that time. Leaving it up would
      // offer the same gone slot again, and fail again.
      if (failed.code === 'SLOT_TAKEN' || failed.code === 'SLOT_BLOCKED') {
        setMoveSlot(null);
        setSlotsNonce((value) => value + 1);
      }
    } finally {
      setSaving(false);
    }
  }

  if (appointment.loading) {
    return (
      <Screen title={t('common.loading')}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (appointment.error) {
    return (
      <Screen title={t('common.somethingWentWrong')}>
        <Feedback tone="danger" message={appointment.error} />
      </Screen>
    );
  }

  const row = appointment.data;
  if (!row) {
    return <Screen title={t('common.notFound')} subtitle={t('appointments.notInThisBusiness')} />;
  }

  const actions = availableActions(row.status, row.startsAt);
  const canMove = row.status === 'pending' || row.status === 'confirmed';
  const serviceId = row.items[0]?.serviceId ?? null;
  const events = history.data ?? [];
  const queued = notifications.data ?? [];
  const charges = payments.data ?? [];
  const moved = rescheduleCount(events);

  return (
    <Screen
      title={format.time(row.startsAt, timezone)}
      subtitle={format.date(row.startsAt, timezone)}
    >
      <Card>
        <Text variant="label" tone={statusTone(row.status)}>
          {tk(statusLabelKey(row.status))}
        </Text>
        <Text variant="caption" tone="muted">
          {format.time(row.startsAt, timezone)} {'–'} {format.time(row.endsAt, timezone)}
          {row.professionalName ? ` · ${row.professionalName}` : ''}
        </Text>
        {moved > 0 && (
          <Text variant="caption" tone="muted">
            {moved === 1
              ? t('appointments.movedOnce')
              : t('appointments.movedTimes', { count: moved })}
          </Text>
        )}
        {row.cancellationReason && (
          <Text variant="caption" tone="danger">
            {t('appointments.cancelledWithReason', { reason: row.cancellationReason })}
          </Text>
        )}
      </Card>

      <Card>
        <Text variant="heading">{t('appointments.customer')}</Text>
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
            {t('appointments.note', { note: row.notes })}
          </Text>
        )}
      </Card>

      <Card>
        <Text variant="heading">{t('appointments.service')}</Text>
        {row.items.length === 0 && (
          <Text variant="body" tone="muted">
            {t('appointments.noServiceRecorded')}
          </Text>
        )}
        {row.items.map((item) => (
          <Text key={item.name} variant="body">
            {item.name} {'·'} {format.duration(item.durationMinutes)} {'·'}{' '}
            {format.money(item.price, item.currency)}
          </Text>
        ))}
        <Text variant="caption" tone="muted">
          {t('appointments.snapshotNote')}
        </Text>
      </Card>

      {canMove && (
        <Card>
          <Text variant="heading">{t('reschedule.heading')}</Text>

          {!moving && (
            <>
              <Text variant="body" tone="muted">
                {t('reschedule.intro')}
              </Text>
              <Button
                label={t('reschedule.action')}
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
                  reloadKey={slotsNonce}
                />
              ) : (
                <Feedback tone="muted" message={t('reschedule.noServiceSoType')} />
              )}

              <Field
                label={t('reschedule.orTypeATime')}
                value={moveTime}
                onChangeText={(value) => {
                  setMoveTime(value);
                  if (value) setMoveSlot(null);
                }}
                placeholder="14:30"
                autoCapitalize="none"
                hint={t('reschedule.typeATimeHint')}
              />

              <ToggleRow
                label={t('reschedule.allowOutsideHours')}
                description={t('reschedule.allowOutsideHoursHint')}
                value={outsideHours}
                onChange={setOutsideHours}
              />

              <Field
                label={t('reschedule.whyOptional')}
                value={moveReason}
                onChangeText={setMoveReason}
                placeholder={t('reschedule.whyPlaceholder')}
              />

              {moveFailure && <Feedback tone="danger" message={moveFailure} />}

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button
                  label={t('reschedule.confirm')}
                  style={{ flex: 1 }}
                  loading={saving}
                  onPress={move}
                />
                <Button
                  label={t('reschedule.keep')}
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
        <Text variant="heading">{t('appointments.whatNow')}</Text>

        {actions.length === 0 && (
          <Text variant="body" tone="muted">
            {row.status === 'cancelled'
              ? t('appointments.cancelledSlotReleased')
              : t('appointments.closedNothingToDo')}
          </Text>
        )}

        {actions.some((action) => action.status === 'cancelled') && (
          <Field
            label={t('appointments.reasonOptional')}
            value={reason}
            onChangeText={setReason}
            placeholder={t('appointments.reasonPlaceholder')}
          />
        )}

        {failure && <Feedback tone="danger" message={failure} />}

        <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
          {actions.map((action) => (
            <Button
              key={action.status}
              label={tk(action.labelKey)}
              variant={action.destructive ? 'ghost' : 'primary'}
              loading={pending === action.status}
              onPress={() => apply(action.status)}
            />
          ))}
        </View>

        {row.status === 'confirmed' && actions.length === 1 && (
          <Text variant="caption" tone="muted">
            {t('appointments.afterStartHint')}
          </Text>
        )}
      </Card>

      <Card>
        <Text variant="heading">{t('payments.title')}</Text>
        {payments.loading && <ActivityIndicator />}

        {charges.length === 0 && !payments.loading && (
          <Text variant="body" tone="muted">
            {t('payments.notRequired')}
          </Text>
        )}

        <View style={{ gap: spacing.sm }}>
          {charges.map((charge) => (
            <View key={charge.id} style={{ gap: 2 }}>
              <Text variant="body">
                {format.money(charge.amount, charge.currency)} {'·'}{' '}
                {tk(`payments.requirement.${charge.requirement}`)}
              </Text>
              <Text
                variant="caption"
                tone={
                  charge.status === 'paid'
                    ? 'success'
                    : charge.status === 'failed'
                      ? 'danger'
                      : 'muted'
                }
              >
                {tk(`payments.status.${charge.status}`)}
                {charge.paidAt
                  ? ` · ${t('payments.paidAt', {
                      when: format.dateTime(charge.paidAt, timezone),
                    })}`
                  : ''}
                {charge.refundedAt
                  ? ` · ${t('payments.refunded', {
                      when: format.dateTime(charge.refundedAt, timezone),
                    })}`
                  : ''}
              </Text>

              {charge.status === 'paid' && (
                <>
                  <Field
                    label={t('payments.refundReason')}
                    value={refundReason}
                    onChangeText={setRefundReason}
                  />
                  <Button
                    variant="secondary"
                    label={t('payments.refund')}
                    loading={refunding}
                    onPress={() => refund(charge.id)}
                  />
                </>
              )}
            </View>
          ))}
        </View>

        {charges.some((charge) => charge.status === 'paid') && (
          <Text variant="caption" tone="muted">
            {t('payments.refundExplainer')}
          </Text>
        )}
      </Card>

      <Card>
        <Text variant="heading">{t('notifications.forThisAppointment')}</Text>
        {notifications.loading && <ActivityIndicator />}
        {queued.length === 0 && !notifications.loading && (
          <Text variant="body" tone="muted">
            {row.customer.email
              ? t('notifications.noneForAppointment')
              : t('notifications.noEmailOnFile')}
          </Text>
        )}
        <View style={{ gap: spacing.sm }}>
          {queued.map((notification) => (
            <View key={notification.id} style={{ gap: 2 }}>
              <Text variant="body">
                {tk(`notifications.kind.${notification.kind}`)} {'·'}{' '}
                {tk(`notifications.channel.${notification.channel}`)}
              </Text>
              <Text
                variant="caption"
                tone={notification.status === 'failed' ? 'danger' : 'muted'}
              >
                {tk(`notifications.status.${notification.status}`)} {'·'}{' '}
                {notification.sentAt
                  ? t('notifications.sentAt', {
                      when: format.dateTime(notification.sentAt, timezone),
                    })
                  : t('notifications.scheduledFor', {
                      when: format.dateTime(notification.scheduledFor, timezone),
                    })}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <Text variant="heading">{t('history.heading')}</Text>
        {history.loading && <ActivityIndicator />}
        {events.length === 0 && !history.loading && (
          <Text variant="body" tone="muted">
            {t('history.empty')}
          </Text>
        )}
        <View style={{ gap: spacing.sm }}>
          {events.map((event) => {
            const described = describeEvent(
              event,
              (at) => format.dateTime(at, timezone),
              tk,
            );
            return (
              <View key={event.id} style={{ gap: 2 }}>
                <Text variant="body">{tk(described.key, described.values)}</Text>
                <Text variant="caption" tone="muted">
                  {format.date(event.occurredAt, timezone)} {'·'}{' '}
                  {format.time(event.occurredAt, timezone)}
                  {event.reason ? ` · ${event.reason}` : ''}
                </Text>
              </View>
            );
          })}
        </View>
        <Text variant="caption" tone="muted">
          {t('history.immutable')}
        </Text>
      </Card>
    </Screen>
  );
}
