import { useTranslation } from 'react-i18next';
import { Pressable, Switch, View } from 'react-native';

import { Button, Feedback, Text, TimeInput } from '@/components/ui';
import type { ScheduleEntry } from '@/features/availability/schedule';
import { spacing, useTheme } from '@/theme';

/** One working period, carrying the position it holds in the whole week. */
export interface DayWindow {
  index: number;
  entry: ScheduleEntry;
  error?: string;
}

export interface DayHoursRowProps {
  /** The weekday, already translated. */
  label: string;
  windows: DayWindow[];
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  onToggle: (open: boolean) => void;
  onChange: (index: number, patch: Partial<ScheduleEntry>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onCopyToOthers?: () => void;
  /** Off on the last row, so the card does not end in a line. */
  divider?: boolean;
}

/**
 * A day of the week, open or closed, with the hours it is open.
 *
 * ---------------------------------------------------------------------------
 * Why a switch rather than "Open this day"
 * ---------------------------------------------------------------------------
 *
 * The editor this replaced had no idea of a day being closed. A closed day was
 * a day with no periods in it, so to close Monday you removed its hours one by
 * one, and to open it you pressed a button called *Open this day* that added
 * some. The state was implied by the absence of rows, which is the kind of
 * thing that is obvious once you know it and impossible before.
 *
 * Now the switch says it. Turning a day off keeps its hours in the screen's
 * memory, so turning it back on gives them back instead of a default nobody
 * asked for -- closing a shop for a fortnight should not cost you the hours
 * you spent typing.
 *
 * ---------------------------------------------------------------------------
 * Why the hours are folded away
 * ---------------------------------------------------------------------------
 *
 * Seven days with two time boxes each is a page you have to scroll to see the
 * end of, and the question the screen exists to answer -- *what is my week?* --
 * cannot be answered by scrolling. Collapsed, the seven summaries are the
 * week, in one glance. The boxes appear for the day being changed.
 *
 * ---------------------------------------------------------------------------
 * Split shifts
 * ---------------------------------------------------------------------------
 *
 * Two periods on one day is normal here: 09:00-13:00 and 15:00-19:00 is how
 * most of the trade actually works. They are separate rows rather than one
 * field with a break in it, because a break is not a third time -- and because
 * a third period, which some days have, then costs nothing.
 */
export function DayHoursRow({
  label,
  windows,
  expanded,
  onExpand,
  onToggle,
  onChange,
  onAdd,
  onRemove,
  onCopyToOthers,
  divider = true,
}: DayHoursRowProps) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const open = windows.length > 0;
  const broken = windows.some((window) => window.error);

  // The whole day on one line, so a glance down the card reads as a week.
  const summary = open
    ? windows.map((window) => `${window.entry.startTime}–${window.entry.endTime}`).join(' · ')
    : t('availability.closed');

  return (
    <View
      style={{
        paddingVertical: spacing.xs,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: palette.borderSubtle,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Pressable
          accessibilityRole="button"
          // Everything the collapsed row shows, said in one breath.
          accessibilityLabel={`${label}. ${summary}`}
          accessibilityState={{ expanded, disabled: !open }}
          aria-expanded={expanded}
          disabled={!open}
          onPress={() => onExpand(!expanded)}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            minHeight: 52,
          }}
        >
          <View style={{ flex: 1, gap: 1 }}>
            <Text variant="label">{label}</Text>
            <Text
              variant="caption"
              tone={broken ? 'danger' : 'muted'}
              numberOfLines={2}
            >
              {summary}
            </Text>
          </View>
          {open && (
            <Text variant="label" tone="muted">
              {expanded ? '▴' : '▾'}
            </Text>
          )}
        </Pressable>

        <Switch
          value={open}
          onValueChange={onToggle}
          // The weekday alone: a screen reader already says "switch, on".
          accessibilityLabel={label}
          trackColor={{ true: palette.accent, false: palette.border }}
        />
      </View>

      {open && expanded && (
        <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
          {windows.map((window) => (
            <View key={window.index} style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
                <TimeInput
                  label={t('availability.from')}
                  value={window.entry.startTime}
                  onChange={(startTime) => onChange(window.index, { startTime })}
                  invalid={!!window.error}
                />
                <TimeInput
                  label={t('availability.to')}
                  value={window.entry.endTime}
                  onChange={(endTime) => onChange(window.index, { endTime })}
                  invalid={!!window.error}
                />
                <Button
                  label={t('availability.removeWindow')}
                  variant="ghost"
                  size="compact"
                  onPress={() => onRemove(window.index)}
                />
              </View>
              {window.error && <Feedback tone="danger" message={window.error} />}
            </View>
          ))}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            <Button
              label={t('availability.addWindow')}
              variant="ghost"
              size="compact"
              onPress={onAdd}
            />
            {onCopyToOthers && (
              <Button
                label={t('availability.copyToOtherDays')}
                variant="ghost"
                size="compact"
                onPress={onCopyToOthers}
              />
            )}
          </View>
        </View>
      )}
    </View>
  );
}
