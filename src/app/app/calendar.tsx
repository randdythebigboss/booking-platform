import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppointmentRow } from '@/components/appointment-row';
import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Screen, Text } from '@/components/ui';
import { addDays, isoDateIn, zonedInstant } from '@/features/availability';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { formatDateIn } from '@/lib/format';
import { fetchAppointments } from '@/services/appointments';
import { spacing } from '@/theme';

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_DAYS = 14;

/**
 * "What do I have today, and what is coming next?"
 *
 * A day at a time plus a short look ahead. Deliberately not a week grid: on a
 * phone that is a lot of chrome for a question this simple.
 */
export default function CalendarScreen() {
  const { business } = useRequiredWorkspace();
  const timezone = business.timezone;

  const today = isoDateIn(new Date(), timezone);
  const [date, setDate] = useState(today);

  const dayStart = zonedInstant(date, 0, timezone);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

  const day = useAsyncData(
    () => fetchAppointments({ businessId: business.id, from: dayStart, to: dayEnd }),
    [business.id, date],
  );

  const upcoming = useAsyncData(
    () =>
      fetchAppointments({
        businessId: business.id,
        from: new Date(),
        to: new Date(Date.now() + UPCOMING_DAYS * DAY_MS),
        statuses: ['pending', 'confirmed'],
        limit: 20,
      }),
    [business.id, today],
  );

  useRefreshOnFocus(day.reload);
  useRefreshOnFocus(upcoming.reload);

  return (
    <Screen title="Calendar" subtitle={`Times are ${timezone.replace(/_/g, ' ')}.`}>
      <Card>
        <Text variant="heading">
          {formatDateIn(new Date(`${date}T12:00:00Z`), timezone)}
        </Text>
        {date !== today && (
          <Text variant="caption" tone="muted">
            Today is {formatDateIn(new Date(), timezone)}.
          </Text>
        )}

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
          <Button
            label="Previous"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => setDate(addDays(date, -1))}
          />
          <Button
            label="Today"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => setDate(today)}
          />
          <Button
            label="Next"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => setDate(addDays(date, 1))}
          />
        </View>
      </Card>

      {day.loading && <ActivityIndicator />}
      {day.error && <Feedback tone="danger" message={day.error} />}
      {!day.loading && (day.data ?? []).length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            Nothing booked that day.
          </Text>
        </Card>
      )}

      <View style={{ gap: spacing.sm }}>
        {(day.data ?? []).map((appointment) => (
          <AppointmentRow
            key={appointment.id}
            appointment={appointment}
            timezone={timezone}
            showDate={false}
          />
        ))}
      </View>

      <Text variant="heading">Coming up</Text>
      {upcoming.loading && <ActivityIndicator />}
      {!upcoming.loading && (upcoming.data ?? []).length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            Nothing in the next {UPCOMING_DAYS} days.
          </Text>
        </Card>
      )}
      <View style={{ gap: spacing.sm }}>
        {(upcoming.data ?? []).map((appointment) => (
          <AppointmentRow key={appointment.id} appointment={appointment} timezone={timezone} />
        ))}
      </View>
    </Screen>
  );
}
