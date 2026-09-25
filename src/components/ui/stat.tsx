import { View } from 'react-native';

import { radius, spacing, useTheme } from '@/theme';
import { Text } from './text';

export interface StatProps {
  value: string | number;
  /** What the number counts. Never an adjective on its own. */
  label: string;
  tone?: 'default' | 'accent' | 'warning';
}

/**
 * One number and what it counts.
 *
 * The labels this replaced were "próximas" and "por confirmar" -- adjectives
 * with no noun, so a 1 and a 0 sat on the dashboard without saying one what.
 * A stat's label has to survive being read on its own.
 */
export function Stat({ value, label, tone = 'default' }: StatProps) {
  const { palette } = useTheme();

  const colour =
    tone === 'accent' ? palette.accent : tone === 'warning' ? palette.warning : palette.text;

  return (
    <View
      // The number and its label are one thing to a screen reader, not a
      // stray digit followed by an unattached phrase.
      accessibilityRole="text"
      accessibilityLabel={`${value} ${label}`}
      style={{
        flex: 1,
        minWidth: 120,
        gap: 2,
        padding: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
      }}
    >
      <Text variant="metric" style={{ color: colour }}>
        {value}
      </Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}
