import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { TOUCH_TARGET, radius, spacing, useTheme } from '@/theme';
import { Text } from './text';
import type { SelectOption } from './option';

export interface DropdownProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Sits under the control when there is nothing wrong. */
  hint?: string;
  error?: string;
}

/**
 * A choice that takes one line until you press it.
 *
 * It replaced a control that rendered its whole list, always. That is bearable
 * for three options inside a form and wrong for a filter at the top of a
 * screen: two of them stacked pushed the first appointment four hundred pixels
 * down the page, and the fifth status was cut off by the scroll cap anyway.
 *
 * The open list is a modal rather than a floating panel because React Native
 * has no portal: a panel drawn inside the page is clipped by whatever card it
 * sits in, and the one place that is guaranteed to be above everything is a
 * modal. It also gives the platform's own dismiss-on-back for free.
 */
export function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  error,
}: DropdownProps<T>) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const chosen = options.find((option) => option.value === value);

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="label">{label}</Text>

      <Pressable
        accessibilityRole="button"
        // The label and the current answer together: "Status, all statuses".
        accessibilityLabel={`${label}: ${chosen?.label ?? ''}`}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          minHeight: TOUCH_TARGET,
          paddingHorizontal: spacing.md,
          borderWidth: 1,
          borderColor: error ? palette.danger : palette.border,
          borderRadius: radius.md,
          backgroundColor: palette.surface,
        }}
      >
        <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
          {chosen?.label ?? ''}
        </Text>
        <Text variant="caption" tone="muted">
          {'▾'}
        </Text>
      </Pressable>

      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Pressing away from the list closes it, which is what everybody
            expects and what a keyboard's Escape does through onRequestClose. */}
        <Pressable
          accessibilityRole="button"
          // Not the control's own name: two things called "Estado" is worse
          // than one of them being called what it does.
          accessibilityLabel={t('common.close')}
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: spacing.lg,
            backgroundColor: palette.scrim,
          }}
        >
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={label}
            style={{
              width: '100%',
              maxWidth: 420,
              alignSelf: 'center',
              borderRadius: radius.lg,
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                padding: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: palette.borderSubtle,
              }}
            >
              <Text variant="overline" tone="muted">
                {label}
              </Text>
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    aria-checked={selected}
                    accessibilityLabel={option.label}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
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
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
