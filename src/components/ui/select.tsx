import { Pressable, ScrollView, View } from 'react-native';

import { radius, spacing, useTheme } from '@/theme';
import { Text } from './text';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  error?: string;
  hint?: string;
  /** Caps the height so a long list does not take over the screen. */
  maxHeight?: number;
}

/**
 * A plain list of choices rather than a native picker: it looks and behaves
 * the same on web, iOS and Android, and needs no extra dependency.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  error,
  hint,
  maxHeight = 220,
}: SelectProps<T>) {
  const { palette } = useTheme();

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="label">{label}</Text>

      <ScrollView
        style={{
          maxHeight,
          borderWidth: 1,
          borderColor: error ? palette.danger : palette.border,
          borderRadius: radius.md,
          backgroundColor: palette.surface,
        }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              aria-checked={selected}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => ({
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.md,
                backgroundColor: selected
                  ? palette.surfaceMuted
                  : pressed
                    ? palette.surfaceMuted
                    : 'transparent',
              })}
            >
              <Text variant="body" tone={selected ? 'accent' : 'default'}>
                {selected ? '✓  ' : '  '}
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
