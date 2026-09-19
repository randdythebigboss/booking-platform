import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { TOUCH_TARGET, radius, spacing, typography, useTheme } from '@/theme';
import { Text } from './text';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
}

/** Large by default: this product is used one-handed, on a phone, in a hurry. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  accessibilityHint,
}: ButtonProps) {
  const { palette } = useTheme();
  const inactive = disabled || loading;

  const background =
    variant === 'primary'
      ? palette.accent
      : variant === 'secondary'
        ? palette.surfaceMuted
        : 'transparent';
  const labelColor = variant === 'primary' ? palette.accentText : palette.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityHint={accessibilityHint}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background,
          borderColor: variant === 'ghost' ? palette.border : 'transparent',
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
});
