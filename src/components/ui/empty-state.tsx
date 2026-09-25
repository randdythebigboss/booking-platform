import type { ReactNode } from 'react';
import { View } from 'react-native';

import { radius, spacing, useTheme } from '@/theme';
import { Text } from './text';

export interface EmptyStateProps {
  title: string;
  /** One sentence saying what to do about it, not merely that it is empty. */
  body?: string;
  /** The action that resolves the emptiness, where there is one. */
  action?: ReactNode;
  /** A single character standing in for an icon. */
  mark?: string;
}

/**
 * Nothing here yet, said usefully.
 *
 * The version this replaced was a full-height card containing the sentence
 * "Hoy no tienes nada." and nothing else -- a large, loud way to say that
 * there is nothing to look at, on the screen somebody opens every morning.
 *
 * Compact, and it offers the next thing to do wherever there is one.
 */
export function EmptyState({ title, body, action, mark }: EmptyStateProps) {
  const { palette } = useTheme();

  return (
    <View
      style={{
        alignItems: 'center',
        gap: spacing.xs,
        paddingVertical: spacing.lg,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: palette.border,
      }}
    >
      {mark && (
        <Text variant="title" tone="muted" accessibilityElementsHidden>
          {mark}
        </Text>
      )}
      <Text variant="label" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body && (
        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {body}
        </Text>
      )}
      {action && <View style={{ marginTop: spacing.sm }}>{action}</View>}
    </View>
  );
}
