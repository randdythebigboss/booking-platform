import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { TOUCH_TARGET, radius, spacing, typography, useTheme } from '@/theme';
import { Text } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
  /** Shrinks the control for a toolbar or a card footer. */
  size?: 'regular' | 'compact';
}

/**
 * Large by default: this product is used one-handed, on a phone, in a hurry.
 *
 * Four variants, and the difference between them has to be visible at a
 * glance. The screens this replaced put every action in the same grey, so a
 * navigation link, a save and a cancellation all looked equally important --
 * which meant none of them looked important.
 *
 *   primary     the one thing this screen is for. One per screen, usually.
 *   secondary   a real action that is not the main one.
 *   ghost       a quiet action, in a row of others.
 *   danger      something that cannot be undone.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  accessibilityHint,
  size = 'regular',
}: ButtonProps) {
  const { palette } = useTheme();
  const inactive = disabled || loading;

  const background =
    variant === 'primary'
      ? palette.accent
      : variant === 'danger'
        ? palette.dangerMuted
        : variant === 'secondary'
          ? palette.surfaceMuted
          : 'transparent';

  const labelColor =
    variant === 'primary'
      ? palette.accentText
      : variant === 'danger'
        ? palette.danger
        : palette.text;

  const borderColor =
    variant === 'ghost' ? palette.border : variant === 'danger' ? palette.danger : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityHint={accessibilityHint}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'compact' && styles.compact,
        {
          backgroundColor: background,
          borderColor,
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <Text variant="label" style={[typography.label, { color: labelColor }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    // Still comfortably above the 44px a thumb needs.
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
});
