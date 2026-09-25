import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguageToggle } from '@/components/language-toggle';
import { spacing, useTheme } from '@/theme';
import { Text } from './text';

export interface ScreenProps {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  /** Turns off the scroll view for screens that manage their own scrolling. */
  scroll?: boolean;
  /**
   * Hides the language control. For a screen that is already inside another
   * one's frame -- there are none today, and this exists so that the day
   * there is, the answer is not two toggles.
   */
  hideLanguage?: boolean;
  /** Sits under the title: a back link, a status, a small action. */
  header?: ReactNode;
  /**
   * Pinned to the bottom of the viewport, outside the scroll. For the one
   * action a page exists for, on a page long enough to lose it.
   */
  footer?: ReactNode;
}

/**
 * One consistent page frame: safe area, side gutter, generous rhythm, and the
 * language control in the top-right corner of every single screen.
 *
 * The toggle lives here rather than in each page because "the same place on
 * every page" is most of what makes it findable, and because a person who
 * cannot read the current language should not have to scroll to the bottom of
 * a form to find the way out of it.
 */
export function Screen({
  title,
  subtitle,
  children,
  scroll = true,
  hideLanguage = false,
  header,
  footer,
}: ScreenProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();

  const content = (
    <View style={{ gap: spacing.lg, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: spacing.md,
        }}
      >
        <View style={{ flex: 1, gap: spacing.xs }}>
          {title && <Text variant="title">{title}</Text>}
          {subtitle && (
            <Text variant="body" tone="muted">
              {subtitle}
            </Text>
          )}
          {header}
        </View>

        {!hideLanguage && <LanguageToggle />}
      </View>

      {children}
    </View>
  );

  const padding = {
    paddingTop: insets.top + spacing.lg,
    paddingBottom: insets.bottom + spacing.xxl,
    paddingHorizontal: spacing.md,
  };

  const pinned = footer ? (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: palette.border,
        backgroundColor: palette.surface,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: insets.bottom + spacing.sm,
      }}
    >
      <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center' }}>{footer}</View>
    </View>
  ) : null;

  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.background }}>
        <View style={[{ flex: 1 }, padding]}>{content}</View>
        {pinned}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={padding}>
        {content}
      </ScrollView>
      {pinned}
    </View>
  );
}
