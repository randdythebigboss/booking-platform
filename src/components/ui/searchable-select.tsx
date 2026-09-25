import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { TOUCH_TARGET, radius, spacing, typography, useTheme } from '@/theme';
import { Text } from './text';
import type { SelectOption } from './option';

export interface SearchableSelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Placeholder for the filter box, e.g. "Search a city". */
  searchLabel: string;
  /** Said when the filter matches nothing. */
  emptyLabel: string;
  hint?: string;
  error?: string;
  maxHeight?: number;
}

/**
 * A list you can type into.
 *
 * The timezone picker is the case this was built for: seventeen entries today,
 * and the list only grows as the product leaves this region. Scrolling a
 * fixed-height box looking for *Buenos Aires* is a worse experience than
 * typing three letters, and matching on the raw identifier as well as the
 * label means `Sao_Paulo` finds it too.
 *
 * The chosen option is always shown, whatever the filter says, so the control
 * can never look empty while holding a value.
 */
export function SearchableSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  searchLabel,
  emptyLabel,
  hint,
  error,
  maxHeight = 220,
}: SearchableSelectProps<T>) {
  const { palette } = useTheme();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return options;
    return options.filter(
      (option) =>
        option.value.toLowerCase().includes(needle) ||
        option.label.toLowerCase().includes(needle) ||
        // A machine identifier reads as `America/Sao_Paulo`; somebody typing
        // "sao paulo" should still find it.
        option.value.replace(/[/_]/g, ' ').toLowerCase().includes(needle),
    );
  }, [options, query]);

  const chosen = options.find((option) => option.value === value);
  const showing =
    chosen && !visible.some((option) => option.value === value) ? [chosen, ...visible] : visible;

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="label">{label}</Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        accessibilityLabel={searchLabel}
        aria-label={searchLabel}
        placeholder={searchLabel}
        placeholderTextColor={palette.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          typography.body,
          {
            minHeight: TOUCH_TARGET,
            color: palette.text,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderWidth: 1,
            borderColor: error ? palette.danger : palette.border,
            borderRadius: radius.md,
            backgroundColor: palette.surface,
          },
        ]}
      />

      <ScrollView
        style={{
          maxHeight,
          borderWidth: 1,
          borderColor: error ? palette.danger : palette.border,
          borderRadius: radius.md,
          backgroundColor: palette.surface,
        }}
      >
        {showing.length === 0 && (
          <View style={{ padding: spacing.md }}>
            <Text variant="caption" tone="muted">
              {emptyLabel}
            </Text>
          </View>
        )}

        {showing.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              aria-checked={selected}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET,
                justifyContent: 'center',
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                backgroundColor: selected
                  ? palette.accentMuted
                  : pressed
                    ? palette.surfaceMuted
                    : 'transparent',
              })}
            >
              <Text variant="body" tone={selected ? 'accent' : 'default'}>
                {selected ? '✓  ' : '   '}
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
