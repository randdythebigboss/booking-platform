import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { addDays, parseIsoDate } from '@/features/availability';
import { useFormat } from '@/i18n/use-format';
import { radius, spacing, useTheme } from '@/theme';

export interface WeekStripProps {
  /** The day being looked at, `YYYY-MM-DD`. */
  value: string;
  onChange: (date: string) => void;
  /** Today in the business's timezone -- not the device's. */
  today: string;
  label: string;
  /** Days that cannot be chosen, e.g. the past on a booking page. */
  minDate?: string;
  maxDate?: string;
  /** Marks a day as having nothing on it, for a professional's agenda. */
  isEmpty?: (date: string) => boolean;
}

/**
 * Seven days, one of which is selected and one of which is today.
 *
 * ---------------------------------------------------------------------------
 * Selected is not today
 * ---------------------------------------------------------------------------
 *
 * The calendar this replaced showed "sábado, 26 de septiembre" as a heading
 * and "hoy es viernes, 25" as a smaller line underneath, in the same weight
 * and colour. Two different concepts, drawn almost identically, one of which
 * silently changes every midnight.
 *
 * Here they are different things: the selected day is a filled chip, and today
 * carries a dot underneath it whether or not it is the one selected. When they
 * are the same day, it is both -- which is the common case and should look
 * like agreement rather than like a coincidence.
 */
export function WeekStrip({
  value,
  onChange,
  today,
  label,
  minDate,
  maxDate,
  isEmpty,
}: WeekStripProps) {
  const { palette } = useTheme();
  const format = useFormat();

  const days = Array.from({ length: 7 }, (_, index) => addDays(value, index - 3));

  // Midday UTC, so formatting never slides a date into its neighbour.
  const asDate = (iso: string) => {
    const { year, month, day } = parseIsoDate(iso);
    return new Date(Date.UTC(year, month - 1, day, 12));
  };

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', gap: spacing.xs }}
    >
      {days.map((day) => {
        const selected = day === value;
        const isToday = day === today;
        const disabled = (minDate && day < minDate) || (maxDate && day > maxDate);
        const date = asDate(day);
        const empty = isEmpty?.(day) ?? false;

        return (
          <Pressable
            key={day}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected, disabled: !!disabled }}
            aria-checked={selected}
            // The whole date, plus whether it is today, because "26" alone is
            // not something anybody can act on.
            accessibilityLabel={`${format.date(date, 'UTC')}${isToday ? ` — ${format.todayWord()}` : ''}`}
            disabled={!!disabled}
            onPress={() => onChange(day)}
            style={{
              flex: 1,
              minHeight: 62,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              paddingVertical: spacing.xs,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: selected ? palette.accent : palette.border,
              backgroundColor: selected ? palette.accent : palette.surface,
              opacity: disabled ? 0.35 : 1,
            }}
          >
            <Text
              variant="caption"
              style={{ color: selected ? palette.accentText : palette.textMuted }}
            >
              {format.weekday(date, 'UTC')}
            </Text>
            <Text
              variant="label"
              style={{ color: selected ? palette.accentText : palette.text }}
            >
              {date.getUTCDate()}
            </Text>

            {/* Today is marked whether or not it is the day being looked at. */}
            <View
              style={{
                width: 4,
                height: 4,
                borderRadius: 2,
                backgroundColor: isToday
                  ? selected
                    ? palette.accentText
                    : palette.accent
                  : 'transparent',
              }}
            />

            {/* A quiet mark for a day with nothing on it, so a professional
                can see where the gaps are without opening each one. */}
            {empty && !selected && (
              <View
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: palette.borderSubtle,
                }}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
