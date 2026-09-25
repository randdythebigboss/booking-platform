import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { hourIn, type DaySlot, type SlotState } from '@/features/availability';
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

type Part = 'morning' | 'afternoon' | 'evening';

const PARTS: Part[] = ['morning', 'afternoon', 'evening'];

/** Before noon, before six, and after it. */
function partOf(hour: number): Part {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
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
 *
 * ---------------------------------------------------------------------------
 * Free times first, and the rest folded away
 * ---------------------------------------------------------------------------
 *
 * A shop open ten hours at fifteen-minute intervals is forty chips. Drawn as
 * one undifferentiated grid, with most of them greyed out, a customer had to
 * read every one to find the handful they could actually press -- on a phone,
 * three screens of them.
 *
 * So the day is split the way people describe it, morning and afternoon and
 * evening, and only the free times are shown. The others are one line away
 * behind a button that counts them, because "nothing at 11" is genuinely
 * useful when you are deciding whether to ask for a different day, and
 * because a grid with a gap in it and no explanation looks broken.
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
  const [showAll, setShowAll] = useState(false);

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

  const groups = useMemo(() => {
    const byPart = new Map<Part, DaySlot[]>();
    for (const slot of slots) {
      const part = partOf(hourIn(slot.startsAt, timezone));
      const bucket = byPart.get(part);
      if (bucket) bucket.push(slot);
      else byPart.set(part, [slot]);
    }
    return PARTS.map((part) => ({ part, slots: byPart.get(part) ?? [] })).filter(
      (group) => group.slots.length > 0,
    );
  }, [slots, timezone]);

  const hiddenCount = slots.filter((slot) => slot.state !== 'available').length;

  return (
    <View style={{ gap: spacing.md }}>
      {groups.map((group) => {
        const visible = showAll
          ? group.slots
          : group.slots.filter((slot) => slot.state === 'available');
        if (visible.length === 0) return null;

        return (
          <View key={group.part} style={{ gap: spacing.xs }}>
            <Text variant="overline" tone="muted">
              {t(`schedule.${group.part}` as const)}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {visible.map((slot) => {
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
                    // "10:30, taken" rather than a time whose state is only a
                    // colour.
                    accessibilityLabel={`${format.time(slot.startsAt, timezone)} — ${label(slot.state)}`}
                    disabled={!bookable}
                    onPress={() => onSelect(iso)}
                    style={{
                      minWidth: 84,
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
                        // A time that has gone, or belongs to somebody else,
                        // is not a time you are being offered.
                        textDecorationLine: slot.state === 'past' ? 'line-through' : 'none',
                      }}
                    >
                      {format.clock(slot.startsAt, timezone)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}

      {hiddenCount > 0 && (
        <View style={{ flexDirection: 'row' }}>
          <Button
            label={
              showAll
                ? t('schedule.hideUnavailable')
                : t('schedule.showUnavailable', { count: hiddenCount })
            }
            variant="ghost"
            size="compact"
            onPress={() => setShowAll((value) => !value)}
          />
        </View>
      )}

      {/* The legend only means anything once there is something to explain. */}
      {showAll && <Legend revealReason={revealReason} />}
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
