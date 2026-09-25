import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '@/components/providers';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { BookingProgress } from '@/components/booking-progress';
import { DatePicker } from '@/components/date-picker';
import { DaySchedule } from '@/components/day-schedule';
import { OfflineNotice } from '@/components/offline-notice';
import { Button, Card, Feedback, Field, Screen, Text } from '@/components/ui';
import { addDays, isoDateIn, type DaySlot } from '@/features/availability';
import {
  BOOKING_STEPS,
  EMPTY_SELECTION,
  confirmationPath,
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
import { useAsyncData } from '@/hooks/use-async-data';
import { fetchDaySchedule } from '@/services/availability';
import { bookAppointment } from '@/services/booking';
import { fetchPublicBusiness, type PublicBusiness } from '@/services/catalog';
import { fetchPaymentCapabilities } from '@/services/payments';
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
  const { locale } = useLocale();
  // What this deployment can do about money. A service that asks to be paid is
  // not offered when nothing can take the payment -- the alternative is a
  // customer reaching a "Pay now" button with nothing behind it.
  const capabilities = useAsyncData(() => fetchPaymentCapabilities(), []);
  const payable = capabilities.data?.available !== false;
  const format = useFormat();
  const issueText = useIssueText();
  const errorText = useBookingErrorText();

  const [page, setPage] = useState<PageState>({ kind: 'loading' });
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [selection, setSelection] = useState<BookingSelection>(EMPTY_SELECTION);

  const [slots, setSlots] = useState<DaySlot[]>([]);
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

    fetchDaySchedule({
      professionalId,
      serviceId: selection.serviceId,
      date: selection.date,
    })
      .then((result) => {
        if (cancelled) return;
        setSlots(result);
        // A time that was free when the page loaded may not be now, so the
        // chosen one is re-checked against what just came back.
        setSelection((current) =>
          reconcileSlot(
            current,
            result.filter((slot) => slot.state === 'available'),
          ),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setSlotsError(t('booking.couldNotLoadTimes'));
        setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [professionalId, selection.serviceId, selection.date, slotsNonce, t]);

  if (page.kind === 'loading') {
    return (
      <Screen title={t('common.loading')}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (page.kind === 'missing') {
    return <Screen title={t('publicPage.notFound')} subtitle={t('publicPage.linkNotAvailable')} />;
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
  // Today where the shop is, not where the phone is. A customer five time
  // zones away must not be offered a day that has already ended there.
  const today = isoDateIn(new Date(), timezone);
  const freeCount = slots.filter((slot) => slot.state === 'available').length;
  const service = business.services.find((entry) => entry.id === selection.serviceId) ?? null;
  const professional = business.professionals.find((entry) => entry.id === professionalId) ?? null;

  const step = currentStep(selection);
  const reached = (
    target: BookingSelection extends never ? never : (typeof BOOKING_STEPS)[number],
  ) => BOOKING_STEPS.indexOf(target) <= BOOKING_STEPS.indexOf(step);
  const customerErrors = showErrors ? validateCustomer(selection.customer) : {};

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
        // The language this page is in is the language the customer chose to
        // book in, and the one every message about it will be written in.
        locale,
      });

      router.replace(confirmationPath(result.appointmentId, result.accessToken));
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
    <Screen
      title={business.name}
      subtitle={t('publicPage.bookWithUs')}
      /* Once everything is chosen, Confirm stops being something to scroll
         back to. The summary beside it is what is about to be booked, so
         pressing it is never a guess. */
      footer={
        step === 'review' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text variant="label" numberOfLines={1}>
                {service?.name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {/* Short enough to survive a 320px bar: the long date is
                    in the card above, and the strip is on screen anyway. */}
                {selection.slotStartsAt
                  ? `${format.dayAndMonth(new Date(selection.slotStartsAt), timezone)} · ${format.time(new Date(selection.slotStartsAt), timezone)}`
                  : ''}
              </Text>
            </View>
            <Button
              label={t('booking.confirm')}
              loading={booking}
              onPress={() => void confirm()}
            />
          </View>
        ) : undefined
      }
    >
      <BookingProgress step={step} />

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
                  accessibilityState={{ selected: chosen, checked: chosen }}
                  aria-checked={chosen}
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

      <OfflineNotice />

      <Card>
        <Text variant="heading">{t('booking.selectService')}</Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
          {business.services.map((entry) => {
            const chosen = entry.id === selection.serviceId;
            const unavailable = entry.paymentRequirement !== 'none' && !payable;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen, checked: chosen, disabled: unavailable }}
                aria-checked={chosen}
                accessibilityLabel={
                  unavailable ? `${entry.name} — ${t('payments.unavailableService')}` : entry.name
                }
                disabled={unavailable}
                onPress={() => setSelection((current) => selectService(current, entry.id))}
                style={{
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: chosen ? palette.accent : palette.border,
                  backgroundColor: chosen ? palette.surfaceMuted : 'transparent',
                  gap: spacing.xs,
                  opacity: unavailable ? 0.55 : 1,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="label" tone={chosen ? 'accent' : 'default'}>
                      {entry.name}
                    </Text>
                    {entry.description && (
                      <Text variant="caption" tone="muted">
                        {entry.description}
                      </Text>
                    )}
                  </View>
                  {/* Price and length right-aligned, so a list of services
                      reads down as a menu instead of as four paragraphs. */}
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text variant="label">{format.money(entry.price, entry.currency)}</Text>
                    <Text variant="caption" tone="muted">
                      {format.duration(entry.durationMinutes)}
                    </Text>
                  </View>
                </View>
                {unavailable && (
                  <Text variant="caption" tone="danger">
                    {t('payments.unavailableService')}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Saying "cannot be booked online" and stopping there tells somebody
            they cannot have the thing without telling them what to do about
            it. This is the sentence that does, and it appears once rather
            than under every greyed-out service. */}
        {business.services.some((entry) => entry.paymentRequirement !== 'none') && !payable && (
          <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
            {t('payments.unavailableExplainer')}
          </Text>
        )}
      </Card>

      {reached('date') && (
        <Card>
          <Text variant="heading">{t('booking.chooseDate')}</Text>
          <DatePicker
            label={t('common.chooseADay')}
            value={selection.date ?? today}
            minDate={today}
            maxDate={addDays(today, business.bookingHorizonDays)}
            onChange={(date) =>
              setSelection((current) => ({ ...current, date, slotStartsAt: null }))
            }
          />
          <Text variant="caption" tone="muted">
            {t('common.timesShownIn', { timezone: timezone.replace(/_/g, ' ') })}
          </Text>
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
            <Feedback tone="muted" message={t('schedule.nothingOpenThatDay')} />
          )}

          {!slotsLoading && !slotsError && slots.length > 0 && freeCount === 0 && (
            <Feedback tone="muted" message={t('booking.noTimesThatDay')} />
          )}

          {!slotsLoading && !slotsError && slots.length > 0 && (
            <>
              <Text variant="caption" tone="muted">
                {t('schedule.freeCount', { count: freeCount })}
              </Text>
              <DaySchedule
                slots={slots}
                selected={selection.slotStartsAt}
                onSelect={(iso) => setSelection((current) => selectSlot(current, iso))}
                timezone={timezone}
              />
            </>
          )}
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
              inputMode="tel"
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
              inputMode="email"
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
              <Text variant="body">
                {t('payments.servicePrice')}: {format.money(service.price, service.currency)}
              </Text>
            )}

            {/* What is due now, and what is not. A deposit that does not say
                what is left to pay is a surprise waiting at the counter. */}
            {service && service.paymentRequirement !== 'none' && (
              <>
                <Text variant="body" tone="accent">
                  {t('payments.dueNow')}: {format.money(service.amountDueNow, service.currency)}
                </Text>
                {service.paymentRequirement === 'deposit' && (
                  <Text variant="caption" tone="muted">
                    {t('payments.remaining')}:{' '}
                    {format.money(service.amountDueLater, service.currency)}
                  </Text>
                )}
                {capabilities.data?.demo && (
                  <Text variant="label" tone="accent">
                    {t('payments.demoNotice')}
                  </Text>
                )}
              </>
            )}

            <Text variant="caption" tone="muted">
              {t('booking.bookingFor', {
                name: selection.customer.fullName,
                phone: selection.customer.phone,
              })}
            </Text>
            <Text variant="caption" tone="muted">
              {service && service.paymentRequirement !== 'none'
                ? t('payments.holdExplainer')
                : t('booking.nothingCharged')}
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
    </Screen>
  );
}
