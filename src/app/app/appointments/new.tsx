import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { SlotPicker } from '@/components/slot-picker';
import { Button, Card, Feedback, Field, Screen, Select, Text, ToggleRow } from '@/components/ui';
import { isoDateIn, parseClockTime, zonedInstant } from '@/features/availability';
import { toWorkspaceError } from '@/features/workspace';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatDuration, formatMoney } from '@/lib/format';
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
      <Screen title="New appointment">
        <Feedback
          tone="muted"
          message="You are not set up as someone customers book with, so there is no calendar to add to."
        />
      </Screen>
    );
  }

  async function save() {
    if (!professional || !serviceId) {
      setFailure('Choose a service first.');
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
        setFailure('Pick a time from the list, or type one.');
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
          ? 'Use a 24-hour time like 14:30.'
          : toWorkspaceError(cause).message,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen title="New appointment" subtitle="For a phone call, a walk-in or a regular.">
      <Card>
        <Text variant="heading">1. Which service</Text>
        {services.loading && <ActivityIndicator />}
        {services.error && <Feedback tone="danger" message={services.error} />}

        {!services.loading && active.length === 0 && (
          <Feedback tone="muted" message="Add a service first, then you can book one." />
        )}

        {active.length > 0 && (
          <Select
            label="Service"
            value={serviceId ?? ''}
            options={active.map((service) => ({
              value: service.id,
              label: `${service.name} · ${formatDuration(service.durationMinutes)} · ${formatMoney(
                service.price,
                service.currency,
              )}`,
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
          <Text variant="heading">2. When</Text>
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
            label="Or type a time"
            value={time}
            onChangeText={(value) => {
              setTime(value);
              if (value) setSlot(null);
            }}
            placeholder="14:30"
            autoCapitalize="none"
            hint="You are not limited to the times your page offers customers."
          />

          <ToggleRow
            label="Allow a time outside my working hours"
            description="Your public page still only offers your normal hours."
            value={outsideHours}
            onChange={setOutsideHours}
          />
        </Card>
      )}

      {chosenService && (
        <Card>
          <Text variant="heading">3. Who</Text>
          <View style={{ gap: spacing.md }}>
            <Field
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Maria Peralta"
              autoCapitalize="words"
            />
            <Field
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 809 555 0199"
              keyboardType="phone-pad"
              hint="If this number is already in your book, it is the same customer."
            />
            <Field
              label="Email (optional)"
              value={email}
              onChangeText={setEmail}
              placeholder="maria@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Field
              label="Note (optional)"
              value={note}
              onChangeText={setNote}
              placeholder="Called in, wants the usual"
            />
          </View>
        </Card>
      )}

      {failure && <Feedback tone="danger" message={failure} />}

      {chosenService && (
        <Button label="Add to the book" loading={saving} onPress={save} />
      )}
    </Screen>
  );
}
