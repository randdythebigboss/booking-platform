import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { addDays, parseIsoDate } from '@/features/availability';
import { useFormat } from '@/i18n/use-format';
import { radius, spacing, useTheme } from '@/theme';

export interface DatePickerProps {
  /** The chosen day, `YYYY-MM-DD`. */
  value: string;
  onChange: (date: string) => void;
  /** The first day that may be chosen, in the business's own timezone. */
  minDate: string;
  /** The last, from the business's booking horizon. */
  maxDate: string;
  /** Named for a screen reader; the visible heading is the caller's. */
  label: string;
}

const WEEK = 7;

/**
 * Choosing a day, without typing one.
 *
 * A week of days you can tap, with arrows to move a week at a time. This
 * replaced a text field that accepted `YYYY-MM-DD` and nothing else, which
 * asked a customer to know the format, to know today's date, and to not make a
 * typo -- and silently showed an empty calendar when they did.
 *
 * ---------------------------------------------------------------------------
 * Why a week strip rather than a month grid or the platform's date input
 * ---------------------------------------------------------------------------
 *
 * People book soon. A week is what they are choosing between, and seven large
 * targets are easier on a phone than forty-two small ones. A month grid also
 * has to answer "which of these days is the shop even open?", and answering
 * that honestly needs availability for every day in the month -- a lot of work
 * to grey out a Sunday.
 *
 * The platform's own date control was the other candidate. It is excellent on
 * iOS and Android and inconsistent on the web, where this product lives, and
 * it cannot show what this one shows: that the day you are looking at is the
 * day the times below belong to.
 *
 * ---------------------------------------------------------------------------
 * The past
 * ---------------------------------------------------------------------------
 *
 * `minDate` is today *in the business's timezone*, not the device's. A
 * customer in Madrid booking a shop in Santo Domingo must not be offered a day
 * that has already ended there, and must not be refused one that has not
 * started at home. The two are five hours apart and the bug only appears in
 * the evening.
 *
 * Language has nothing to do with any of it. Switching to English re-renders
 * the labels through `Intl` and touches no date.
 */
export function DatePicker({ value, onChange, minDate, maxDate, label }: DatePickerProps) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const format = useFormat();

  const days = useMemo(() => {
    // The strip starts on the chosen day, not on a Monday: the chosen day is
    // what the customer is thinking about, and it is always visible.
    return Array.from({ length: WEEK }, (_, index) => addDays(value, index));
  }, [value]);

  const weekday = useMemo(
    () => new Intl.DateTimeFormat(format.intlLocale, { weekday: 'short', timeZone: 'UTC' }),
    [format.intlLocale],
  );
  const dayNumber = useMemo(
    () => new Intl.DateTimeFormat(format.intlLocale, { day: 'numeric', timeZone: 'UTC' }),
    [format.intlLocale],
  );
  const monthName = useMemo(
    () =>
      new Intl.DateTimeFormat(format.intlLocale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [format.intlLocale],
  );

  // Midday UTC, so a day never slides into its neighbour while being formatted.
  const asDate = (iso: string) => {
    const { year, month, day } = parseIsoDate(iso);
    return new Date(Date.UTC(year, month - 1, day, 12));
  };

  const previous = addDays(value, -WEEK);
  const next = addDays(value, WEEK);
  const canGoBack = previous >= minDate || value > minDate;
  const canGoForward = next <= maxDate;

  const step = (direction: -1 | 1) => {
    const target = addDays(value, direction * WEEK);
    // Clamped rather than refused: tapping back near today lands on today.
    if (target < minDate) return onChange(minDate);
    if (target > maxDate) return onChange(maxDate);
    onChange(target);
  };

  return (
    <View accessibilityLabel={label} style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.previousWeek')}
          accessibilityState={{ disabled: !canGoBack }}
          disabled={!canGoBack}
          onPress={() => step(-1)}
          style={{
            minWidth: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            opacity: canGoBack ? 1 : 0.3,
          }}
        >
          <Text variant="label" tone="accent">
            {'‹'}
          </Text>
        </Pressable>

        <Text variant="label">{monthName.format(asDate(value))}</Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.nextWeek')}
          accessibilityState={{ disabled: !canGoForward }}
          disabled={!canGoForward}
          onPress={() => step(1)}
          style={{
            minWidth: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            opacity: canGoForward ? 1 : 0.3,
          }}
        >
          <Text variant="label" tone="accent">
            {'›'}
          </Text>
        </Pressable>
      </View>

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: 'row', gap: spacing.xs }}
      >
        {days.map((day) => {
          const chosen = day === value;
          const outOfRange = day < minDate || day > maxDate;
          const date = asDate(day);

          return (
            <Pressable
              key={day}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosen, checked: chosen, disabled: outOfRange }}
              aria-checked={chosen}
              // The whole date, spoken. "Wed 30" is not enough to act on.
              accessibilityLabel={format.date(date, 'UTC')}
              disabled={outOfRange}
              onPress={() => onChange(day)}
              style={{
                flex: 1,
                minHeight: 60,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                paddingVertical: spacing.xs,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: chosen ? palette.accent : palette.border,
                backgroundColor: chosen ? palette.accent : 'transparent',
                opacity: outOfRange ? 0.3 : 1,
              }}
            >
              <Text
                variant="caption"
                style={{ color: chosen ? palette.accentText : palette.textMuted }}
              >
                {weekday.format(date)}
              </Text>
              <Text variant="label" style={{ color: chosen ? palette.accentText : palette.text }}>
                {dayNumber.format(date)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
