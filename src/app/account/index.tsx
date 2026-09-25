import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useSession } from '@/components/providers';
import { Button, Card, Feedback, Screen, Text } from '@/components/ui';
import { confirmationPath } from '@/features/booking';
import { useAsyncData } from '@/hooks/use-async-data';
import { useFormat } from '@/i18n/use-format';
import { signOut } from '@/services/auth';
import { fetchMyAppointments } from '@/services/customer-account';
import { radius, spacing, useTheme } from '@/theme';

/**
 * A customer's own appointments, across every business they have booked with.
 *
 * The list hands back each appointment's own booking credential, so opening
 * one lands on exactly the confirmation screen a guest sees -- with the same
 * moving, cancelling and messaging. There is no second implementation of any
 * of it, which is the only reason an optional account was cheap enough to be
 * worth adding.
 */
export default function MyAppointmentsScreen() {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const session = useSession();
  const format = useFormat();

  const appointments = useAsyncData(
    () => (session.status === 'signed-in' ? fetchMyAppointments() : Promise.resolve([])),
    [session.status],
  );

  if (session.status === 'loading') {
    return (
      <Screen title={t('common.loading')}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (session.status !== 'signed-in') {
    return (
      <Screen title={t('account.signInTitle')} subtitle={t('account.signInSubtitle')}>
        <Card>
          <Text variant="body" tone="muted">
            {t('account.guestExplainer')}
          </Text>
          <Link href="/account/login" asChild>
            <Button label={t('auth.signIn')} />
          </Link>
        </Card>
      </Screen>
    );
  }

  const rows = appointments.data ?? [];
  const now = Date.now();
  const upcoming = rows.filter((row) => row.startsAt.getTime() >= now);
  const past = rows.filter((row) => row.startsAt.getTime() < now);

  return (
    <Screen title={t('account.myAppointments')} subtitle={t('account.subtitle')}>
      {session.user?.email && (
        <Text variant="caption" tone="muted">
          {t('account.signedInAs', { email: session.user.email })}
        </Text>
      )}

      {appointments.loading && <ActivityIndicator />}

      {!appointments.loading && rows.length === 0 && (
        <Card>
          <Text variant="body" tone="muted">
            {t('account.none')}
          </Text>
          <Text variant="caption" tone="muted">
            {t('account.noneHint')}
          </Text>
        </Card>
      )}

      {upcoming.length > 0 && (
        <Card>
          <Text variant="heading">{t('account.upcoming')}</Text>
          <View style={{ gap: spacing.sm }}>
            {upcoming.map((row) => (
              <AppointmentLink
                key={row.appointmentId}
                row={row}
                format={format}
                palette={palette}
              />
            ))}
          </View>
        </Card>
      )}

      {past.length > 0 && (
        <Card>
          <Text variant="heading">{t('account.pastAppointments')}</Text>
          <View style={{ gap: spacing.sm }}>
            {past.map((row) => (
              <AppointmentLink
                key={row.appointmentId}
                row={row}
                format={format}
                palette={palette}
              />
            ))}
          </View>
        </Card>
      )}

      {appointments.error && <Feedback tone="danger" message={t('common.somethingWentWrong')} />}

      <Button
        label={t('auth.signOut')}
        variant="secondary"
        onPress={async () => {
          await signOut();
          router.replace('/');
        }}
      />
    </Screen>
  );
}

function AppointmentLink({
  row,
  format,
  palette,
}: {
  row: Awaited<ReturnType<typeof fetchMyAppointments>>[number];
  format: ReturnType<typeof useFormat>;
  palette: ReturnType<typeof useTheme>['palette'];
}) {
  const { t } = useTranslation();

  return (
    <Link href={confirmationPath(row.appointmentId, row.accessToken)} asChild>
      <View
        accessibilityRole="link"
        accessibilityLabel={`${row.businessName} — ${format.dateTime(
          row.startsAt,
          row.businessTimezone,
        )} — ${t(`appointments.status_${row.status}` as 'appointments.status_confirmed')}`}
        style={{
          gap: 2,
          minHeight: 44,
          padding: spacing.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.border,
        }}
      >
        <Text variant="label">{row.businessName}</Text>
        <Text variant="body">{format.dateTime(row.startsAt, row.businessTimezone)}</Text>
        <Text variant="caption" tone="muted">
          {row.serviceName}
          {row.professionalName ? ` · ${row.professionalName}` : ''}
        </Text>
      </View>
    </Link>
  );
}
