import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useSession } from '@/components/providers';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Feedback,
  Initials,
  PressableLink,
  Screen,
  Text,
} from '@/components/ui';
import { statusBadge } from '@/components/appointment-row';
import { confirmationPath } from '@/features/booking';
import { useAsyncData } from '@/hooks/use-async-data';
import { useDynamicT } from '@/i18n/use-dynamic-t';
import { useFormat } from '@/i18n/use-format';
import { signOut } from '@/services/auth';
import { fetchMyAppointments } from '@/services/customer-account';
import { radius, spacing, useTheme } from '@/theme';

type Row = Awaited<ReturnType<typeof fetchMyAppointments>>[number];

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
  const { t } = useTranslation();
  const router = useRouter();
  const session = useSession();

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
    <Screen
      title={t('account.myAppointments')}
      subtitle={
        session.user?.email
          ? t('account.signedInAs', { email: session.user.email })
          : t('account.subtitle')
      }
    >
      {appointments.loading && <ActivityIndicator />}
      {appointments.error && <Feedback tone="danger" message={t('common.somethingWentWrong')} />}

      {!appointments.loading && rows.length === 0 && (
        <Card>
          <EmptyState mark="◷" title={t('account.none')} body={t('account.noneHint')} />
        </Card>
      )}

      {upcoming.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Text variant="heading">{t('account.upcoming')}</Text>
          <View style={{ gap: spacing.sm }}>
            {upcoming.map((row) => (
              <BookingLink key={row.appointmentId} row={row} />
            ))}
          </View>
        </View>
      )}

      {past.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <Text variant="heading">{t('account.pastAppointments')}</Text>
          <View style={{ gap: spacing.sm }}>
            {past.map((row) => (
              <BookingLink key={row.appointmentId} row={row} past />
            ))}
          </View>
        </View>
      )}

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

/**
 * One booking, at one business.
 *
 * A real link rather than a `View` wearing the role: the old one could not be
 * reached with a keyboard at all, which made the whole list unusable without a
 * mouse. The business's mark leads, because a customer's list is sorted by
 * time but read by *who* -- "the barber" and "the dentist" is how people find
 * the row they want.
 */
function BookingLink({ row, past = false }: { row: Row; past?: boolean }) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const tk = useDynamicT();
  const format = useFormat();

  const status = tk(`appointments.status_${row.status}` as 'appointments.status_confirmed');
  const badge = statusBadge(row.status);
  const when = format.dateTime(row.startsAt, row.businessTimezone);

  return (
    <PressableLink
      href={confirmationPath(row.appointmentId, row.accessToken)}
      accessibilityLabel={`${row.businessName} · ${when} · ${status}. ${t('account.openBooking')}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 64,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        opacity: past ? 0.75 : 1,
      }}
    >
      <Initials name={row.businessName} size={40} tone={past ? 'neutral' : 'accent'} />

      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="label" numberOfLines={1}>
          {row.businessName}
        </Text>
        <Text variant="body" numberOfLines={1}>
          {when}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {row.serviceName}
          {row.professionalName ? ` · ${row.professionalName}` : ''}
        </Text>
      </View>

      <Badge label={status} tone={badge.tone} mark={badge.mark} />
    </PressableLink>
  );
}
