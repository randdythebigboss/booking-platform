import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Select, Text } from '@/components/ui';
import { addDays, isoDateIn } from '@/features/availability';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatDateIn, formatDuration, formatTimeIn } from '@/lib/format';
import { fetchAvailableSlots } from '@/services/availability';
import { fetchServices } from '@/services/service-admin';
import { spacing } from '@/theme';

/**
 * What the booking system would actually offer.
 *
 * The slots come from public.get_available_slots, never from a second
 * calculation in the app: this screen exists precisely to show the backend's
 * answer, so that a disagreement would be visible rather than hidden.
 */
export default function SchedulePreviewScreen() {
  const { business, professional } = useRequiredWorkspace();
  const timezone = business.timezone;
  const professionalId = professional?.id ?? null;

  const services = useAsyncData(() => fetchServices(business.id), [business.id]);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [date, setDate] = useState(() => isoDateIn(new Date(), timezone));

  const activeServices = (services.data ?? []).filter((service) => service.isActive);
  const selectedId = serviceId ?? activeServices[0]?.id ?? null;
  const selected = activeServices.find((service) => service.id === selectedId) ?? null;

  const slots = useAsyncData(
    () =>
      professionalId && selectedId
        ? fetchAvailableSlots({ professionalId, serviceId: selectedId, date })
        : Promise.resolve([]),
    [professionalId, selectedId, date],
  );

  if (!professionalId) {
    return (
      <Screen title="Schedule preview">
        <Card>
          <Text variant="body" tone="muted">
            Your account is not set up as a bookable professional in this business yet.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      title="Schedule preview"
      subtitle="The exact times the booking system would offer for this service and date."
    >
      {services.loading && <ActivityIndicator />}
      {services.error && <Feedback tone="danger" message={services.error} />}

      {activeServices.length === 0 && !services.loading && (
        <Card>
          <Text variant="body" tone="muted">
            No active services yet, so there is nothing to offer.
          </Text>
        </Card>
      )}

      {activeServices.length > 0 && (
        <Select
          label="Service"
          value={selectedId ?? ''}
          options={activeServices.map((service) => ({
            value: service.id,
            label: `${service.name} · ${formatDuration(service.durationMinutes)}`,
          }))}
          onChange={setServiceId}
        />
      )}

      <Field
        label="Date"
        value={date}
        onChangeText={setDate}
        placeholder="2026-09-28"
        autoCapitalize="none"
        hint={`Shown in ${timezone.replace(/_/g, ' ')}.`}
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button
          label="Previous day"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => setDate(addDays(date, -1))}
        />
        <Button
          label="Next day"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => setDate(addDays(date, 1))}
        />
      </View>

      <Card>
        <Text variant="heading">{formatDateIn(new Date(`${date}T12:00:00Z`), timezone)}</Text>
        {selected && (
          <Text variant="caption" tone="muted">
            {selected.name} {'·'} {formatDuration(selected.durationMinutes)}
          </Text>
        )}

        {slots.loading && <ActivityIndicator />}
        {slots.error && <Feedback tone="danger" message={slots.error} />}

        {!slots.loading && (slots.data ?? []).length === 0 && (
          <Feedback
            tone="muted"
            message="No times available. Check the weekly schedule, exceptions and blocks for this date."
          />
        )}

        {(slots.data ?? []).length > 0 && (
          <>
            <Text variant="label" tone="success">
              {(slots.data ?? []).length} available
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {(slots.data ?? []).map((slot) => (
                <View
                  key={slot.startsAt.toISOString()}
                  style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm }}
                >
                  <Text variant="body" tone="accent">
                    {formatTimeIn(slot.startsAt, timezone)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </Card>

      <Card>
        <Text variant="caption" tone="muted">
          These slots are calculated by the database, not by this screen. If they look wrong, the
          booking page would be wrong in exactly the same way.
        </Text>
      </Card>
    </Screen>
  );
}
