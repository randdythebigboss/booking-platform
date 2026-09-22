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

/**
 * A labelled text input.
 *
 * The label is drawn above the box and *attached* to it: React Native Web
 * renders a `<Text>` as a `<div>`, which a screen reader does not associate
 * with an input the way a `<label>` would, so the connection has to be made
 * explicitly. Without it the whole form is announced as "edit text, blank" --
 * which is what an audit of this product found.
 *
 * The error and the hint are attached the same way, so somebody who cannot see
 * the red text under the box still hears why the form was refused.
 */
export function Field({ label, error, hint, prefix, ...inputProps }: FieldProps) {
  const { palette } = useTheme();
  const described = error ?? hint;

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
          // The visible label, said out loud. A caller may still override it
          // where the visible text is not the whole story.
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          accessibilityHint={inputProps.accessibilityHint ?? described}
          aria-label={inputProps.accessibilityLabel ?? label}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? error : undefined}
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
