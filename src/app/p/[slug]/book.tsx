import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { LanguageSwitcher } from '@/components/language-switcher';
import { Button, Card, Feedback, Field, Screen, Text } from '@/components/ui';
import { isoDateIn, type Slot } from '@/features/availability';
import {
  BOOKING_STEPS,
  EMPTY_SELECTION,
  currentStep,
  reconcileSlot,
  selectService,
  selectSlot,
  toBookingError,
  updateCustomer,
  validateCustomer,
  type BookingSelection,
} from '@/features/booking';
import { useBookingErrorText } from '@/i18n/use-error-text';
import { useFormat } from '@/i18n/use-format';
import { useIssueText } from '@/i18n/use-issue-text';
import { fetchAvailableSlots } from '@/services/availability';
import { bookAppointment } from '@/services/booking';
import { fetchPublicBusiness, type PublicBusiness } from '@/services/catalog';
import { radius, spacing, useTheme } from '@/theme';

type PageState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error' }
  | { kind: 'ready'; business: PublicBusiness };

export default function BookScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { palette } = useTheme();
  const { t } = useTranslation();
  const format = useFormat();
  const issueText = useIssueText();
  const errorText = useBookingErrorText();

  const [page, setPage] = useState<PageState>({ kind: 'loading' });
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [selection, setSelection] = useState<BookingSelection>(EMPTY_SELECTION);

  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsNonce, setSlotsNonce] = useState(0);

  const [failure, setFailure] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    fetchPublicBusiness(slug)
      .then((business) => {
        if (cancelled) return;
        if (!business) {
          setPage({ kind: 'missing' });
          return;
        }
        setPage({ kind: 'ready', business });
        setProfessionalId(business.professionals[0]?.id ?? null);
        setSelection((current) => ({
          ...current,
          date: current.date ?? isoDateIn(new Date(), business.timezone),
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setPage({ kind: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Availability always comes from the backend, and the chosen time is
  // re-checked against it every time the list is refreshed.
  useEffect(() => {
    if (!professionalId || !selection.serviceId || !selection.date) {
      setSlots([]);
      return;
    }

    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);

    fetchAvailableSlots({
      professionalId,
      serviceId: selection.serviceId,
      date: selection.date,
    })
      .then((result) => {
        if (cancelled) return;
        setSlots(result);
        setSelection((current) => reconcileSlot(current, result));
      })
      .catch(() => {
        if (cancelled) return;
        setSlotsError('We could not load the available times. Please try again.');
        setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [professionalId, selection.serviceId, selection.date, slotsNonce]);

  if (page.kind === 'loading') {
    return (
      <Screen title={t('common.loading')}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (page.kind === 'missing') {
    return (
      <Screen title={t('publicPage.notFound')} subtitle={t('publicPage.linkNotAvailable')} />
    );
  }

  if (page.kind === 'error') {
    return (
      <Screen title={t('common.somethingWentWrong')}>
        <Feedback tone="danger" message={t('publicPage.couldNotLoad')} />
      </Screen>
    );
  }

  const business = page.business;
  const timezone = business.timezone;
  const service = business.services.find((entry) => entry.id === selection.serviceId) ?? null;
  const professional =
    business.professionals.find((entry) => entry.id === professionalId) ?? null;

  const step = currentStep(selection);
  const reached = (target: BookingSelection extends never ? never : (typeof BOOKING_STEPS)[number]) =>
    BOOKING_STEPS.indexOf(target) <= BOOKING_STEPS.indexOf(step);
  const customerErrors = showErrors ? validateCustomer(selection.customer) : {};

  function shiftDate(days: number) {
    setSelection((current) => {
      if (!current.date) return current;
      const next = new Date(`${current.date}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + days);
      const iso = next.toISOString().slice(0, 10);
      return iso === current.date ? current : { ...current, date: iso, slotStartsAt: null };
    });
  }

  async function confirm() {
    if (!professionalId || !selection.serviceId || !selection.slotStartsAt) return;

    setBooking(true);
    setFailure(null);
    try {
      const result = await bookAppointment({
        professionalId,
        serviceId: selection.serviceId,
        startsAt: new Date(selection.slotStartsAt),
        customerName: selection.customer.fullName,
        customerPhone: selection.customer.phone,
        customerEmail: selection.customer.email || undefined,
      });

      router.replace(`/booking/${result.appointmentId}/confirmation?token=${result.accessToken}`);
    } catch (cause) {
      const error = toBookingError(cause);
      setFailure(errorText(error));

      // Someone else may have taken it while this page sat open. Drop the
      // choice and show what is genuinely free now.
      if (error.isSlotConflict) {
        setSelection((current) => ({ ...current, slotStartsAt: null }));
        setSlotsNonce((value) => value + 1);
      }
    } finally {
      setBooking(false);
    }
  }

  return (
    <Screen title={business.name} subtitle={t('publicPage.bookWithUs')}>
      {business.professionals.length > 1 && (
        <Card>
          <Text variant="label">{t('booking.whoWouldYouLikeToSee')}</Text>
          <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
            {business.professionals.map((pro) => {
              const chosen = pro.id === professionalId;
              return (
                <Pressable
                  key={pro.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                  onPress={() => {
                    setProfessionalId(pro.id);
                    setSelection((current) => ({ ...current, slotStartsAt: null }));
                  }}
                  style={{
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: chosen ? palette.accent : palette.border,
                  }}
                >
                  <Text variant="body" tone={chosen ? 'accent' : 'default'}>
                    {pro.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      <Card>
        <Text variant="heading">{t('booking.selectService')}</Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
          {business.services.map((entry) => {
            const chosen = entry.id === selection.serviceId;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen }}
                onPress={() => setSelection((current) => selectService(current, entry.id))}
                style={{
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: chosen ? palette.accent : palette.border,
                  backgroundColor: chosen ? palette.surfaceMuted : 'transparent',
                  gap: spacing.xs,
                }}
              >
                <Text variant="label" tone={chosen ? 'accent' : 'default'}>
                  {entry.name}
                </Text>
                <Text variant="caption" tone="muted">
                  {format.duration(entry.durationMinutes)} {'·'}{' '}
                  {format.money(entry.price, entry.currency)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {reached('date') && (
        <Card>
          <Text variant="heading">{t('booking.chooseDate')}</Text>
          <Field
            label={t('booking.date')}
            value={selection.date ?? ''}
            onChangeText={(value) =>
              setSelection((current) => ({ ...current, date: value, slotStartsAt: null }))
            }
            placeholder="2026-09-28"
            autoCapitalize="none"
            hint={t('common.timesShownIn', { timezone: timezone.replace(/_/g, ' ') })}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              label={t('common.previousDay')}
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => shiftDate(-1)}
            />
            <Button
              label={t('common.nextDay')}
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => shiftDate(1)}
            />
          </View>
        </Card>
      )}

      {reached('slot') && selection.date && (
        <Card>
          <Text variant="heading">{t('booking.chooseTime')}</Text>
          <Text variant="caption" tone="muted">
            {format.date(new Date(`${selection.date}T12:00:00Z`), timezone)}
          </Text>

          {slotsLoading && <ActivityIndicator />}
          {slotsError && <Feedback tone="danger" message={slotsError} />}

          {!slotsLoading && !slotsError && slots.length === 0 && (
            <Feedback tone="muted" message={t('booking.noTimesThatDay')} />
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {slots.map((slot) => {
              const iso = slot.startsAt.toISOString();
              const chosen = iso === selection.slotStartsAt;
              return (
                <Pressable
                  key={iso}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                  onPress={() => setSelection((current) => selectSlot(current, iso))}
                  style={{
                    minWidth: 92,
                    alignItems: 'center',
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: chosen ? palette.accent : palette.border,
                    backgroundColor: chosen ? palette.accent : 'transparent',
                  }}
                >
                  <Text variant="label" style={chosen ? { color: palette.accentText } : undefined}>
                    {format.time(slot.startsAt, timezone)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      {reached('details') && (
        <Card>
          <Text variant="heading">{t('booking.yourDetails')}</Text>
          <View style={{ gap: spacing.md, marginTop: spacing.xs }}>
            <Field
              label={t('booking.fullName')}
              value={selection.customer.fullName}
              onChangeText={(value) =>
                setSelection((current) => updateCustomer(current, { fullName: value }))
              }
              autoCapitalize="words"
              autoComplete="name"
              error={issueText(customerErrors.fullName)}
            />
            <Field
              label={t('booking.phone')}
              value={selection.customer.phone}
              onChangeText={(value) =>
                setSelection((current) => updateCustomer(current, { phone: value }))
              }
              keyboardType="phone-pad"
              autoComplete="tel"
              error={issueText(customerErrors.phone)}
            />
            <Field
              label={t('booking.email')}
              value={selection.customer.email}
              onChangeText={(value) =>
                setSelection((current) => updateCustomer(current, { email: value }))
              }
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              error={issueText(customerErrors.email)}
              hint={t('booking.emailHint')}
            />
          </View>
        </Card>
      )}

      <Card>
        <Text variant="heading">{t('booking.reviewAndConfirm')}</Text>

        {step !== 'review' ? (
          <Text variant="body" tone="muted">
            {step === 'service' && t('booking.startByChoosingService')}
            {step === 'date' && t('booking.chooseTheDay')}
            {step === 'slot' && t('booking.chooseOneOfTheTimes')}
            {step === 'details' && t('booking.addYourDetails')}
          </Text>
        ) : (
          <View style={{ gap: spacing.xs }}>
            <Text variant="body">
              <Text variant="label">{service?.name}</Text>
              {service ? ` · ${format.duration(service.durationMinutes)}` : ''}
            </Text>
            <Text variant="body" tone="muted">
              {professional?.displayName ?? business.name}
            </Text>
            <Text variant="body" tone="accent">
              {selection.slotStartsAt
                ? t('booking.at', {
                    date: format.date(new Date(selection.slotStartsAt), timezone),
                    time: format.time(new Date(selection.slotStartsAt), timezone),
                  })
                : ''}
            </Text>
            {service && (
              <Text variant="body">{format.money(service.price, service.currency)}</Text>
            )}
            <Text variant="caption" tone="muted">
              {t('booking.bookingFor', {
                name: selection.customer.fullName,
                phone: selection.customer.phone,
              })}
            </Text>
            <Text variant="caption" tone="muted">
              {t('booking.nothingCharged')}
            </Text>
          </View>
        )}

        {failure && <Feedback tone="danger" message={failure} />}

        <Button
          label={t('booking.confirm')}
          loading={booking}
          disabled={step !== 'review'}
          onPress={() => {
            setShowErrors(true);
            if (step === 'review') void confirm();
          }}
        />
      </Card>

      <Card>
        <Text variant="caption" tone="muted">
          {t('booking.livePromise', { business: business.name })}
        </Text>
      </Card>

      <Card>
        <LanguageSwitcher />
      </Card>
    </Screen>
  );
}
