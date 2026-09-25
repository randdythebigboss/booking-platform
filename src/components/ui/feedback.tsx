import { View } from 'react-native';

import { radius, spacing, useTheme } from '@/theme';
import { Text } from './text';

export interface FeedbackProps {
  tone: 'danger' | 'success' | 'warning' | 'muted';
  message: string;
}

/**
 * A single inline banner.
 *
 * Every tone but `muted` is the outcome of something somebody just did, so it
 * is announced. `muted` is standing explanation -- the sentence about
 * reminders not being delivered, say -- and announcing that as an alert every
 * time a screen renders would be noise, not help.
 */
export function Feedback({ tone, message }: FeedbackProps) {
  const { palette } = useTheme();

  const color =
    tone === 'danger'
      ? palette.danger
      : tone === 'success'
        ? palette.success
        : tone === 'warning'
          ? palette.warning
          : palette.textMuted;

  return (
    <View
      accessibilityRole={tone === 'muted' ? undefined : 'alert'}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: color,
        borderRadius: radius.sm,
        backgroundColor: palette.surfaceMuted,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
      }}
    >
      <Text variant="body" tone={tone}>
        {message}
      </Text>
    </View>
  );
}
