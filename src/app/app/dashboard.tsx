import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppointmentRow } from '@/components/appointment-row';
import { useRequiredWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Screen, Text } from '@/components/ui';
import { isoDateIn, zonedInstant } from '@/features/availability';
import { useAsyncData } from '@/hooks/use-async-data';
import { publicBookingUrl } from '@/lib/env';
import { formatDateIn, formatTimeIn } from '@/lib/format';
import { fetchAppointments } from '@/services/appointments';
import { signOut } from '@/services/auth';
import { spacing } from '@/theme';

const UPCOMING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export default function DashboardScreen() {
  const { business, professional } = useRequiredWorkspace();
  const router = useRouter();
  const timezone = business.timezone;
  const [signingOut, setSigningOut] = useState(false);

  const today = isoDateIn(new Date(), timezone);
  const dayStart = zonedInstant(today, 0, timezone);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const horizon = new Date(dayStart.getTime() + UPCOMING_DAYS * DAY_MS);

  const todays = useAsyncData(
    () =>
      fetchAppointments({
        businessId: business.id,
        from: dayStart,
        to: dayEnd,
        statuses: ['pending', 'confirmed', 'completed', 'no_show'],
      }),
    [business.id, today],
  );

  const upcoming = useAsyncData(
    () =>
      fetchAppointments({
        businessId: business.id,
        from: new Date(),
        to: horizon,
        statuses: ['pending', 'confirmed'],
      }),
    [business.id, today],
  );

  const next = (upcoming.data ?? [])[0] ?? null;
  const pendingCount = (upcoming.data ?? []).filter((a) => a.status === 'pending').length;
  const link = publicBookingUrl(business.slug);

  return (
    <Screen title={business.name} subtitle={professional?.displayName ?? undefined}>
      <Card>
        <Text variant="label">Next appointment</Text>
        {upcoming.loading && <ActivityIndicator />}
        {!upcoming.loading && !next && (
          <Text variant="body" tone="muted">
            Nothing booked in the next {UPCOMING_DAYS} days.
          </Text>
        )}
        {next && (
          <>
            <Text variant="title">{formatTimeIn(next.startsAt, timezone)}</Text>
            <Text variant="body">{formatDateIn(next.startsAt, timezone)}</Text>
            <Text variant="body" tone="muted">
              {next.customer.fullName}
              {next.items[0] ? ' · ' + next.items[0].name : ''}
            </Text>
          </>
        )}
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Card style={{ flex: 1 }}>
          <Text variant="title">{(upcoming.data ?? []).length}</Text>
          <Text variant="caption" tone="muted">
            upcoming
          </Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text variant="title" tone={pendingCount > 0 ? 'accent' : 'default'}>
            {pendingCount}
          </Text>
          <Text variant="caption" tone="muted">
            awaiting confirmation
          </Text>
        </Card>
      </View>

      <Text variant="heading">Today</Text>
      {todays.loading && <ActivityIndicator />}
      {todays.error && <Feedback tone="danger" message={todays.error} />}
      {!todays.loading && (todays.data ?? []).length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            Nothing today.
          </Text>
        </Card>
      )}
      <View style={{ gap: spacing.sm }}>
        {(todays.data ?? []).map((appointment) => (
          <AppointmentRow
            key={appointment.id}
            appointment={appointment}
            timezone={timezone}
            showDate={false}
          />
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Link href="/app/calendar" asChild>
          <Button label="Calendar" variant="secondary" />
        </Link>
        <Link href="/app/appointments" asChild>
          <Button label="All appointments" variant="secondary" />
        </Link>
        <Link href="/app/availability" asChild>
          <Button label="Availability" variant="secondary" />
        </Link>
        <Link href="/app/services" asChild>
          <Button label="Services" variant="secondary" />
        </Link>
        <Link href="/app/settings" asChild>
          <Button label="Settings" variant="secondary" />
        </Link>
      </View>

      <Card>
        <Text variant="label">Your booking link</Text>
        <Text variant="body" tone="accent" selectable>
          {link}
        </Text>
        {business.isPublished ? (
          <Text variant="caption" tone="success">
            Published. Anyone with this link can book.
          </Text>
        ) : (
          <Feedback tone="muted" message="Not published yet. Publish it from Settings." />
        )}
        <Link href={`/p/${business.slug}`} asChild>
          <Button label="Open my public page" variant="secondary" />
        </Link>
      </Card>

      <Button
        label="Sign out"
        variant="ghost"
        loading={signingOut}
        onPress={async () => {
          setSigningOut(true);
          try {
            await signOut();
            router.replace('/login');
          } finally {
            setSigningOut(false);
          }
        }}
      />
    </Screen>
  );
}
