import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { DaySlot, SlotState } from '@/features/availability';
import { useFormat } from '@/i18n/use-format';
import { radius, spacing, useTheme } from '@/theme';

export interface DayScheduleProps {
  slots: DaySlot[];
  /** The chosen start time, as an ISO string, or null. */
  selected: string | null;
  onSelect: (startsAt: string) => void;
  timezone: string;
  /**
   * The professional's own preview tells `taken` from `unavailable`. The
   * public page does not; see below.
   */
  revealReason?: boolean;
}

/**
 * The shape of a day: what is free, what is spoken for, what has gone.
 *
 * ---------------------------------------------------------------------------
 * What a stranger is allowed to learn
 * ---------------------------------------------------------------------------
 *
 * That a time is not free. Nothing else. No name, no initials, no service, no
 * duration, no hint of how many people are booked. The database does not
 * return those things and this could not show them if it wanted to.
 *
 * `taken` and `unavailable` are also drawn identically to the public even
 * though the data distinguishes them, because the difference is exactly the
 * fact worth protecting: "the shop closed this off" and "somebody has an
 * appointment" are different pieces of information about a real person's
 * movements. The professional's own preview passes `revealReason`, because it
 * is their calendar and the distinction is the point.
 */
export function DaySchedule({
  slots,
  selected,
  onSelect,
  timezone,
  revealReason = false,
}: DayScheduleProps) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const format = useFormat();

  const label = (state: SlotState): string => {
    if (state === 'available') return t('schedule.available');
    if (state === 'past') return t('schedule.past');
    // To the public, a closed hour and a booked one read the same.
    if (!revealReason) return t('schedule.taken');
    return state === 'taken' ? t('schedule.taken') : t('schedule.closed');
  };

  const appearance = (state: SlotState, chosen: boolean) => {
    if (chosen) {
      return { borderColor: palette.accent, backgroundColor: palette.accent, opacity: 1 };
    }
    if (state === 'available') {
      return { borderColor: palette.border, backgroundColor: 'transparent', opacity: 1 };
    }
    if (state === 'past') {
      return { borderColor: palette.border, backgroundColor: 'transparent', opacity: 0.35 };
    }
    // Taken and closed: filled, muted, and obviously not a button.
    return { borderColor: palette.border, backgroundColor: palette.surfaceMuted, opacity: 0.7 };
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {slots.map((slot) => {
          const iso = slot.startsAt.toISOString();
          const chosen = iso === selected;
          const bookable = slot.state === 'available';
          const style = appearance(slot.state, chosen);

          return (
            <Pressable
              key={iso}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosen, checked: chosen, disabled: !bookable }}
              aria-checked={chosen}
              // "10:30, taken" rather than a time whose state is only a colour.
              accessibilityLabel={`${format.time(slot.startsAt, timezone)} — ${label(slot.state)}`}
              disabled={!bookable}
              onPress={() => onSelect(iso)}
              style={{
                minWidth: 92,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                ...style,
              }}
            >
              <Text
                variant="label"
                style={{
                  color: chosen ? palette.accentText : palette.text,
                  // A time that has gone, or belongs to somebody else, is not
                  // a time you are being offered.
                  textDecorationLine: slot.state === 'past' ? 'line-through' : 'none',
                }}
              >
                {format.time(slot.startsAt, timezone)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Legend revealReason={revealReason} />
    </View>
  );
}

/** Colour alone never carries meaning; this is what the shading means. */
function Legend({ revealReason }: { revealReason: boolean }) {
  const { palette } = useTheme();
  const { t } = useTranslation();

  const entries: { key: string; text: string; swatch: object }[] = [
    {
      key: 'available',
      text: t('schedule.available'),
      swatch: { borderColor: palette.border, backgroundColor: 'transparent' },
    },
    {
      key: 'taken',
      text: t('schedule.taken'),
      swatch: { borderColor: palette.border, backgroundColor: palette.surfaceMuted },
    },
    {
      key: 'past',
      text: t('schedule.past'),
      swatch: { borderColor: palette.border, backgroundColor: 'transparent', opacity: 0.35 },
    },
  ];

  if (revealReason) {
    entries.splice(2, 0, {
      key: 'closed',
      text: t('schedule.closed'),
      swatch: { borderColor: palette.border, backgroundColor: palette.surfaceMuted },
    });
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        {entries.map((entry) => (
          <View
            key={entry.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
          >
            <View
              style={{ width: 14, height: 14, borderRadius: 4, borderWidth: 1, ...entry.swatch }}
            />
            <Text variant="caption" tone="muted">
              {entry.text}
            </Text>
          </View>
        ))}
      </View>

      {!revealReason && (
        <Text variant="caption" tone="muted">
          {t('schedule.fullDayHint')}
        </Text>
      )}
    </View>
  );
}
