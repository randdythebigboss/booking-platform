import { TextInput, View, type TextInputProps } from 'react-native';

import { TOUCH_TARGET, radius, spacing, typography, useTheme } from '@/theme';
import { Text } from './text';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  hint?: string;
  /** Rendered immediately before the input, e.g. the public-link prefix. */
  prefix?: string;
}

export function Field({ label, error, hint, prefix, ...inputProps }: FieldProps) {
  const { palette } = useTheme();

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="label">{label}</Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: TOUCH_TARGET,
          borderWidth: 1,
          borderColor: error ? palette.danger : palette.border,
          borderRadius: radius.md,
          backgroundColor: palette.surface,
          paddingHorizontal: spacing.md,
          gap: spacing.xs,
        }}
      >
        {prefix && (
          <Text variant="body" tone="muted">
            {prefix}
          </Text>
        )}
        <TextInput
          placeholderTextColor={palette.textMuted}
          style={[typography.body, { flex: 1, color: palette.text, paddingVertical: spacing.sm }]}
          {...inputProps}
        />
      </View>

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
