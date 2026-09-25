import { Pressable, ScrollView, View } from 'react-native';

import { TOUCH_TARGET, radius, spacing, useTheme } from '@/theme';
import { Text } from './text';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Named for a screen reader; the visible label is the caller's heading. */
  label: string;
}

/**
 * A row of choices, one of which is on.
 *
 * This replaced a `Select` that rendered on the web as a permanently expanded
 * list: two of them together pushed the appointment list four hundred pixels
 * down the page, so the filters were the screen and the thing being filtered
 * was below the fold.
 *
 * It scrolls horizontally rather than wrapping, because three or four short
 * options on a narrow phone should stay one row and stay recognisably a
 * single control.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  const { palette } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{
          flexDirection: 'row',
          gap: 2,
          padding: 3,
          borderRadius: radius.md,
          backgroundColor: palette.surfaceMuted,
        }}
      >
        {options.map((option) => {
          const chosen = option.value === value;

          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosen, checked: chosen }}
              aria-checked={chosen}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={{
                minHeight: TOUCH_TARGET,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: spacing.md,
                borderRadius: radius.sm,
                backgroundColor: chosen ? palette.surface : 'transparent',
              }}
            >
              <Text variant="label" style={{ color: chosen ? palette.text : palette.textMuted }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
