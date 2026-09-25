import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguageToggle } from '@/components/language-toggle';
import { PressableLink } from '@/components/ui/pressable-link';
import { Text } from '@/components/ui/text';
import { WorkspaceSidebar, WorkspaceTabBar, useIsDesktop } from '@/components/workspace-nav';
import { maxWidth, radius, spacing, useTheme } from '@/theme';

export interface WorkspaceShellProps {
  /** The business, shown in the header and the sidebar. */
  businessName: string;
  /** The person, when the business has one named. */
  professionalName?: string;
  title: string;
  subtitle?: string;
  /** A primary action for this screen, drawn in the header on a wide screen. */
  action?: ReactNode;
  /** Filters, tabs or a date strip that belong to the screen, under the title. */
  toolbar?: ReactNode;
  children?: ReactNode;
  /** A page whose content is a single column of prose or a form. */
  narrow?: boolean;
}

/**
 * The frame every professional screen sits in.
 *
 * One place decides what navigation looks like, where the language toggle
 * lives, how wide the content gets and how much room the phone's bottom bar
 * needs. Before this, each screen drew its own page and the only way between
 * them was a stack of grey buttons on the dashboard -- so there was no sense
 * of being anywhere, and no way back except the browser's own arrow.
 *
 * The header is deliberately two rows on a phone and one on a desk: a business
 * name, a screen title and a language control do not fit across 375px without
 * one of them being cut, and the one that would be cut is the title.
 */
export function WorkspaceShell({
  businessName,
  professionalName,
  title,
  subtitle,
  action,
  toolbar,
  children,
  narrow = false,
}: WorkspaceShellProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktop();

  const header = (
    <View
      style={{
        gap: spacing.sm,
        paddingTop: isDesktop ? spacing.lg : insets.top + spacing.md,
        paddingBottom: spacing.md,
        paddingHorizontal: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: palette.border,
        backgroundColor: palette.surface,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: narrow ? maxWidth.reading : maxWidth.wide,
          alignSelf: 'center',
          gap: spacing.sm,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: spacing.md,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            {/* On a phone the sidebar is not there to say whose workspace this
                is, so the header says it. */}
            {!isDesktop && (
              <Text variant="overline" tone="muted" numberOfLines={1}>
                {businessName}
              </Text>
            )}
            <Text variant="title" numberOfLines={2}>
              {title}
            </Text>
            {subtitle && (
              <Text variant="caption" tone="muted" numberOfLines={3}>
                {subtitle}
              </Text>
            )}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            {isDesktop && action}
            <LanguageToggle />
            <AccountButton
              businessName={businessName}
              professionalName={professionalName}
              compact={!isDesktop}
            />
          </View>
        </View>

        {/* On a phone the primary action goes under the title, full width,
            where a thumb reaches it. */}
        {!isDesktop && action}

        {toolbar}
      </View>
    </View>
  );

  const body = (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
        // Room for the bottom bar, so the last row of a list is never under it.
        paddingBottom: spacing.xxl,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: narrow ? maxWidth.reading : maxWidth.wide,
          alignSelf: 'center',
          gap: spacing.lg,
        }}
      >
        {children}
      </View>
    </ScrollView>
  );

  if (isDesktop) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: palette.background }}>
        <WorkspaceSidebar businessName={businessName} />
        <View style={{ flex: 1 }}>
          {header}
          {body}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {header}
      {body}
      <WorkspaceTabBar />
    </View>
  );
}

/** The way to the account: who is signed in, and how to stop being. */
function AccountButton({
  businessName,
  professionalName,
  compact,
}: {
  businessName: string;
  professionalName?: string;
  compact: boolean;
}) {
  const { palette } = useTheme();
  const { t } = useTranslation();

  // Initials rather than an avatar: the product has no photographs, and a
  // generic silhouette says less than two letters do.
  const source = professionalName || businessName;
  const initials = source
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <PressableLink
      href="/app/account"
      accessibilityLabel={t('nav.account', { name: source })}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 40,
        paddingHorizontal: compact ? 0 : spacing.sm,
        borderRadius: radius.pill,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: palette.accentMuted,
        }}
      >
        <Text variant="caption" style={{ color: palette.accent, fontWeight: '700' }}>
          {initials}
        </Text>
      </View>
      {!compact && (
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ maxWidth: 120 }}>
          {source}
        </Text>
      )}
    </PressableLink>
  );
}
