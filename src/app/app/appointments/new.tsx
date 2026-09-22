import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { SlotPicker } from '@/components/slot-picker';
import { Button, Card, Feedback, Field, Screen, Select, Text, ToggleRow } from '@/components/ui';
import { isoDateIn, parseClockTime, zonedInstant } from '@/features/availability';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useFormat } from '@/i18n/use-format';
import { useAsyncData } from '@/hooks/use-async-data';
import { createManualAppointment } from '@/services/appointments';
import { fetchServices } from '@/services/service-admin';
import { spacing } from '@/theme';

/**
 * The professional putting somebody in the book themselves.
 *
 * A phone call, a walk-in, a regular who always comes on Thursdays. It is not
 * the public booking form with a different label: it arrives confirmed, it is
 * not held to the published slot grid, and it can fall outside working hours
 * if the professional says so. None of those are relaxations a customer gets,
 * and the public page keeps offering exactly what it offered before.
 */
export default function NewAppointmentScreen() {
  const router = useRouter();
  const { business, professional } = useRequiredWorkspace();
  const { t } = useTranslation();
  const format = useFormat();
  const errorText = useWorkspaceErrorText();
  const timezone = business.timezone;

  const services = useAsyncData(() => fetchServices(business.id), [business.id]);
  const active = (services.data ?? []).filter((service) => service.isActive);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [date, setDate] = useState(isoDateIn(new Date(), timezone));
  const [slot, setSlot] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [outsideHours, setOutsideHours] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');

  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const chosenService = active.find((service) => service.id === serviceId) ?? null;

  if (!professional) {
    return (
      <Screen title={t('manualBooking.title')}>
        <Feedback tone="muted" message={t('manualBooking.notBookable')} />
      </Screen>
    );
  }

  async function save() {
    if (!professional || !serviceId) {
      setFailure(t('manualBooking.addServiceFirst'));
      return;
    }

    setSaving(true);
    setFailure(null);

    try {
      let startsAt: Date;
      if (slot) {
        startsAt = new Date(slot);
      } else if (time.trim()) {
        startsAt = zonedInstant(date, parseClockTime(time.trim()), timezone);
      } else {
        setFailure(t('reschedule.pickOrType'));
        return;
      }

      const id = await createManualAppointment({
        professionalId: professional.id,
        serviceId,
        startsAt,
        customerName: name,
        customerPhone: phone,
        customerEmail: email.trim() || undefined,
        notes: note.trim() || undefined,
        allowOutsideHours: outsideHours,
      });

      router.replace(`/app/appointments/${id}`);
    } catch (cause) {
      setFailure(
        cause instanceof Error && cause.name === 'InvalidTimeValueError'
          ? t('reschedule.badTime')
          : errorText(cause),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen title={t('manualBooking.title')} subtitle={t('manualBooking.subtitle')}>
      <Card>
        <Text variant="heading">{t('manualBooking.stepService')}</Text>
        {services.loading && <ActivityIndicator />}
        {services.error && <Feedback tone="danger" message={services.error} />}

        {!services.loading && active.length === 0 && (
          <Feedback tone="muted" message={t('manualBooking.addServiceFirst')} />
        )}

        {active.length > 0 && (
          <Select
            label={t('manualBooking.service')}
            value={serviceId ?? ''}
            options={active.map((service) => ({
              value: service.id,
              label: `${service.name} · ${format.duration(service.durationMinutes)} · ${format.money(service.price, service.currency)}`,
            }))}
            onChange={(value) => {
              setServiceId(value);
              setSlot(null);
            }}
            maxHeight={220}
          />
        )}
      </Card>

      {chosenService && (
        <Card>
          <Text variant="heading">{t('manualBooking.stepWhen')}</Text>
          <SlotPicker
            professionalId={professional.id}
            serviceId={chosenService.id}
            timezone={timezone}
            date={date}
            onDateChange={(next) => {
              setDate(next);
              setSlot(null);
            }}
            selected={slot}
            onSelect={(iso) => {
              setSlot(iso);
              setTime('');
            }}
          />

          <Field
            label={t('reschedule.orTypeATime')}
            value={time}
            onChangeText={(value) => {
              setTime(value);
              if (value) setSlot(null);
            }}
            placeholder="14:30"
            autoCapitalize="none"
            hint={t('manualBooking.typeATimeHint')}
          />

          <ToggleRow
            label={t('reschedule.allowOutsideHours')}
            description={t('reschedule.allowOutsideHoursHint')}
            value={outsideHours}
            onChange={setOutsideHours}
          />
        </Card>
      )}

      {chosenService && (
        <Card>
          <Text variant="heading">{t('manualBooking.stepWho')}</Text>
          <View style={{ gap: spacing.md }}>
            <Field
              label={t('manualBooking.name')}
              value={name}
              onChangeText={setName}
              placeholder={t('manualBooking.namePlaceholder')}
              autoCapitalize="words"
            />
            <Field
              label={t('manualBooking.phone')}
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 809 555 0199"
              keyboardType="phone-pad"
              hint={t('manualBooking.phoneHint')}
            />
            <Field
              label={t('manualBooking.email')}
              value={email}
              onChangeText={setEmail}
              placeholder="maria@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Field
              label={t('manualBooking.noteOptional')}
              value={note}
              onChangeText={setNote}
              placeholder={t('manualBooking.notePlaceholder')}
            />
          </View>
        </Card>
      )}

      {failure && <Feedback tone="danger" message={failure} />}

      {chosenService && (
        <Button label={t('manualBooking.submit')} loading={saving} onPress={save} />
      )}
    </Screen>
  );
}
