import { View } from 'react-native';

import { radius, spacing, useTheme } from '@/theme';
import { Text } from './text';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  /**
   * A short mark drawn before the label. Colour alone must never be the only
   * thing carrying the status, so a badge that means something different from
   * its neighbours says so in a character as well as in a hue.
   */
  mark?: string;
}

/**
 * A small piece of state: confirmed, cancelled, hidden, pending.
 *
 * Both a tint and a mark, deliberately. Roughly one man in twelve cannot tell
 * the green one from the red one, and a status that is only a colour is a
 * status they cannot read at all.
 */
export function Badge({ label, tone = 'neutral', mark }: BadgeProps) {
  const { palette } = useTheme();

  const colours: Record<BadgeTone, { background: string; text: string }> = {
    neutral: { background: palette.surfaceMuted, text: palette.textMuted },
    accent: { background: palette.accentMuted, text: palette.accent },
    success: { background: palette.successMuted, text: palette.success },
    warning: { background: palette.warningMuted, text: palette.warning },
    danger: { background: palette.dangerMuted, text: palette.danger },
  };

  const colour = colours[tone];

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: 3,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.pill,
        backgroundColor: colour.background,
      }}
    >
      {mark && (
        <Text variant="caption" style={{ color: colour.text, fontWeight: '700' }}>
          {mark}
        </Text>
      )}
      <Text variant="caption" style={{ color: colour.text, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}
