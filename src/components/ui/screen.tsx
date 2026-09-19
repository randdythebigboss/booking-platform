import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, useTheme } from '@/theme';
import { Text } from './text';

export interface ScreenProps {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  /** Turns off the scroll view for screens that manage their own scrolling. */
  scroll?: boolean;
}

/** One consistent page frame: safe area, side gutter, generous rhythm. */
export function Screen({ title, subtitle, children, scroll = true }: ScreenProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();

  const content = (
    <View style={{ gap: spacing.lg, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
      {(title || subtitle) && (
        <View style={{ gap: spacing.xs }}>
          {title && <Text variant="title">{title}</Text>}
          {subtitle && (
            <Text variant="body" tone="muted">
              {subtitle}
            </Text>
          )}
        </View>
      )}
      {children}
    </View>
  );

  const padding = {
    paddingTop: insets.top + spacing.lg,
    paddingBottom: insets.bottom + spacing.xxl,
    paddingHorizontal: spacing.md,
  };

  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: palette.background }, padding]}>{content}</View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={padding}
    >
      {content}
    </ScrollView>
  );
}
