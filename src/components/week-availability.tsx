import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { addDays, parseIsoDate, type DayAvailabilitySummary } from '@/features/availability';
import { useFormat } from '@/i18n/use-format';
import { TOUCH_TARGET, radius, spacing, useTheme } from '@/theme';

export interface WeekAvailabilityProps {
  /** The chosen day, `YYYY-MM-DD`. */
  value: string;
  onChange: (date: string) => void;
  /** The first day of the strip. The caller owns which week is shown. */
  weekStart: string;
  onWeekStart: (date: string) => void;
  /** Today, in the business timezone -- never the device's. */
  today: string;
  /** The last bookable day, from the business's horizon. */
  maxDate: string;
  days: DayAvailabilitySummary[];
  loading: boolean;
  /** Jumps to the first day in range that has anything free. */
  onNextAvailable?: () => void;
  nextAvailableBusy?: boolean;
  label: string;
}

const WEEK = 7;

/**
 * Seven days, each already saying whether it is worth tapping.
 *
 * ---------------------------------------------------------------------------
 * The problem
 * ---------------------------------------------------------------------------
 *
 * The strip this replaces drew seven identical chips. A customer tapped one,
 * waited, and was told "no hay horas disponibles ese día" -- and then had to
 * guess which of the other six might work, one tap and one round trip at a
 * time. On a shop closed on Sunday and full today that is several failures
 * before the first success, and nothing on the page ever hinted which day to
 * try. It was the single worst thing in the product.
 *
 * ---------------------------------------------------------------------------
 * What each chip says, and why it is not a colour
 * ---------------------------------------------------------------------------
 *
 *   a number   how many start times are free -- the more useful fact by far,
 *              because "2 left" and "26 left" are different decisions
 *   ✕          worked that day, nothing left
 *   —          not a working day
 *   ·          already gone, or past the booking horizon
 *
 * Tint follows, but never carries it alone: about one man in twelve cannot
 * use the tint, and a customer holding a phone in daylight cannot either. The
 * spoken label is the whole sentence -- "martes 29 de septiembre, 14 horas
 * libres" -- because a screen reader reaches a chip without the legend.
 *
 * ---------------------------------------------------------------------------
 * What it never says
 * ---------------------------------------------------------------------------
 *
 * Who booked anything, what they booked, or when. The count is of what is
 * OPEN. See the migration `a_week_can_be_looked_at_whole` for why an aggregate
 * is the privacy-safe shape here.
 */
export function WeekAvailability({
  value,
  onChange,
  weekStart,
  onWeekStart,
  today,
  maxDate,
  days,
  loading,
  onNextAvailable,
  nextAvailableBusy = false,
  label,
}: WeekAvailabilityProps) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const format = useFormat();

  const dates = useMemo(
    () => Array.from({ length: WEEK }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  // Midday UTC, so formatting never slides a date into its neighbour.
  const asDate = (iso: string) => {
    const { year, month, day } = parseIsoDate(iso);
    return new Date(Date.UTC(year, month - 1, day, 12));
  };

  const first = asDate(dates[0] ?? weekStart);
  const last = asDate(dates[dates.length - 1] ?? weekStart);
  const heading =
    first.getUTCMonth() === last.getUTCMonth()
      ? format.monthAndYear(first)
      : `${format.monthOnly(first)} – ${format.monthAndYear(last)}`;

  const canGoBack = addDays(weekStart, -WEEK) >= today || weekStart > today;
  const canGoForward = weekStart <= maxDate;

  const step = (direction: -1 | 1) => {
    const target = addDays(weekStart, direction * WEEK);
    onWeekStart(target < today ? today : target);
  };

  return (
    <View style={{ gap: spacing.sm }} accessibilityLabel={label}>
      {/* The controls are a real toolbar, not two bare arrows at opposite ends
          of a wide bar. Same height, same weight, named out loud. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <StepButton
          glyph="‹"
          label={t('common.previousWeek')}
          disabled={!canGoBack}
          onPress={() => step(-1)}
        />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="label" numberOfLines={1}>
            {heading}
          </Text>
        </View>
        <StepButton
          glyph="›"
          label={t('common.nextWeek')}
          disabled={!canGoForward}
          onPress={() => step(1)}
        />
      </View>

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: 'row', gap: 4 }}
      >
        {dates.map((date) => {
          const summary = byDate.get(date);
          const isToday = date === today;
          const chosen = date === value;
          const gone = date < today || date > maxDate;
          const state = gone ? (date < today ? 'past' : 'beyond') : (summary?.state ?? 'open');
          // A full day can still be opened: seeing that every hour is taken
          // is a different fact from "the shop is shut", and the customer
          // does something different about each. Closed, past and beyond
          // have nothing behind them, so they stay unpressable.
          const bookable = state === 'open' || state === 'full';

          const mark =
            state === 'open'
              ? String(summary?.freeCount ?? '')
              : state === 'full'
                ? '✕'
                : state === 'closed'
                  ? '—'
                  : '·';

          const spoken =
            state === 'open'
              ? t('schedule.dayFree', { count: summary?.freeCount ?? 0 })
              : state === 'full'
                ? t('schedule.dayFull')
                : state === 'closed'
                  ? t('schedule.dayClosed')
                  : t('schedule.dayGone');

          return (
            <Pressable
              key={date}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosen, checked: chosen, disabled: !bookable }}
              aria-checked={chosen}
              accessibilityLabel={`${format.date(asDate(date), 'UTC')} — ${spoken}`}
              disabled={!bookable}
              onPress={() => onChange(date)}
              style={{
                flex: 1,
                minHeight: 74,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                paddingVertical: spacing.xs,
                borderRadius: radius.md,
                borderWidth: chosen ? 2 : 1,
                borderColor: chosen
                  ? palette.accent
                  : state === 'open'
                    ? palette.border
                    : palette.borderSubtle,
                backgroundColor: chosen
                  ? palette.accent
                  : state === 'open'
                    ? palette.surface
                    : palette.surfaceMuted,
                opacity: state === 'past' || state === 'beyond' ? 0.4 : 1,
              }}
            >
              <Text
                variant="caption"
                style={{ color: chosen ? palette.accentText : palette.textMuted }}
              >
                {format.weekday(asDate(date), 'UTC')}
              </Text>
              <Text variant="label" style={{ color: chosen ? palette.accentText : palette.text }}>
                {asDate(date).getUTCDate()}
              </Text>
              <Text
                variant="caption"
                style={{
                  fontWeight: '700',
                  color: chosen
                    ? palette.accentText
                    : state === 'open'
                      ? palette.accent
                      : palette.textMuted,
                }}
              >
                {loading && !summary && !gone ? '·' : mark}
              </Text>

              {/* Today is marked whether or not it is the day being looked at. */}
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: isToday
                    ? chosen
                      ? palette.accentText
                      : palette.accent
                    : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: spacing.sm,
        }}
      >
        <Text variant="caption" tone="muted" style={{ flex: 1, minWidth: 180 }}>
          {t('schedule.weekLegend')}
        </Text>
        {loading && <ActivityIndicator />}
        {onNextAvailable && (
          <Button
            label={t('schedule.nextAvailable')}
            variant="secondary"
            size="compact"
            loading={nextAvailableBusy}
            onPress={onNextAvailable}
          />
        )}
      </View>
    </View>
  );
}

/** A week step: big enough to hit, and named for somebody who cannot see it. */
function StepButton({
  glyph,
  label,
  disabled,
  onPress,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minWidth: TOUCH_TARGET,
        minHeight: TOUCH_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Text variant="heading" tone={disabled ? 'muted' : 'accent'}>
        {glyph}
      </Text>
    </Pressable>
  );
}
