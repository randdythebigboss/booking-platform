import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { normalizeClockInput } from '@/features/availability';
import { TOUCH_TARGET, radius, spacing, typography, useTheme } from '@/theme';
import { Text } from './text';

export interface TimeInputProps {
  label: string;
  /** `HH:mm`. */
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}

/**
 * An hour and a minute, typed the way people type them.
 *
 * ---------------------------------------------------------------------------
 * Why it is a text box and not a picker
 * ---------------------------------------------------------------------------
 *
 * A professional setting up the week types the same four numbers seven times.
 * A wheel or a dropdown of 96 quarter-hours is slower than the keyboard for
 * that, and on the web it is a different control in every browser. The trade
 * is that a text box will take nonsense -- so this one does not keep nonsense:
 * whatever is in it is normalised the moment focus leaves, and `9` becomes
 * `09:00` rather than an error message after Save.
 *
 * The draft is held locally while the field has focus, because rewriting the
 * value on every keystroke would move the caret and make `09:30` impossible to
 * type. It is pushed up on blur, which is also when the week is re-validated.
 */
export function TimeInput({ label, value, onChange, invalid }: TimeInputProps) {
  const { palette } = useTheme();
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  // A change from outside -- discarding, copying Monday across the week -- has
  // to reach a field that is not being typed in.
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const normalized = normalizeClockInput(draft);
    if (normalized === null) {
      // Unreadable: put back the last good value rather than silently keeping
      // a string the scheduler cannot use.
      setDraft(value);
      return;
    }
    setDraft(normalized);
    if (normalized !== value) onChange(normalized);
  };

  return (
    <View style={{ flex: 1, maxWidth: 132, gap: spacing.xs }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        onSubmitEditing={commit}
        accessibilityLabel={label}
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        inputMode="numeric"
        maxLength={5}
        placeholder="09:00"
        placeholderTextColor={palette.textMuted}
        selectTextOnFocus
        style={[
          typography.body,
          {
            minHeight: TOUCH_TARGET,
            color: palette.text,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderWidth: 1,
            borderColor: invalid ? palette.danger : palette.border,
            borderRadius: radius.md,
            backgroundColor: palette.surface,
            textAlign: 'center',
          },
        ]}
      />
    </View>
  );
}
