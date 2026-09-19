import { View } from 'react-native';

import { radius, spacing, useTheme } from '@/theme';
import { Text } from './text';

export interface FeedbackProps {
  tone: 'danger' | 'success' | 'muted';
  message: string;
}

/** A single inline banner for the result of an action. */
export function Feedback({ tone, message }: FeedbackProps) {
  const { palette } = useTheme();

  const color =
    tone === 'danger' ? palette.danger : tone === 'success' ? palette.success : palette.textMuted;

  return (
    <View
      accessibilityRole="alert"
      style={{
        borderLeftWidth: 3,
        borderLeftColor: color,
        borderRadius: radius.sm,
        backgroundColor: palette.surfaceMuted,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
      }}
    >
      <Text variant="body" tone={tone === 'muted' ? 'muted' : tone}>
        {message}
      </Text>
    </View>
  );
}
