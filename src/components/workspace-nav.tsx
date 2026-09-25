import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableLink } from '@/components/ui/pressable-link';
import { Text } from '@/components/ui/text';
import { BREAKPOINT_DESKTOP, radius, spacing, useTheme } from '@/theme';

/**
 * Where a professional can go, and which of those places they are in.
 *
 * ---------------------------------------------------------------------------
 * The information architecture
 * ---------------------------------------------------------------------------
 *
 * Five destinations existed before as six identical grey buttons stacked down
 * the dashboard, which is a menu rather than navigation: it told you nothing
 * about where you were, and it disappeared the moment you went anywhere.
 *
 * Four of them are daily work and get a permanent place:
 *
 *   Inicio        the morning glance -- next appointment, today, the link
 *   Agenda        the calendar, one day at a time
 *   Citas         every booking, filtered
 *   Servicios     what the business sells
 *
 * The rest -- availability, notices, settings -- are configuration. They are
 * visited when something changes, not several times a day, so on a phone they
 * live behind *Más*. Putting seven equal things in a bottom bar would make all
 * seven hard to hit and none of them findable.
 *
 * On a desk there is room, so the sidebar shows all of it at once and the
 * grouping is drawn instead of hidden.
 */

export interface NavDestination {
  key: string;
  href: string;
  labelKey:
    | 'nav.dashboard'
    | 'nav.calendar'
    | 'nav.appointments'
    | 'nav.availability'
    | 'nav.services'
    | 'nav.notifications'
    | 'nav.settings'
    | 'nav.more';
  /** A single character standing in for an icon, so nothing is downloaded. */
  mark: string;
  /** Shown in the phone's bottom bar rather than behind *Más*. */
  primary: boolean;
}

export const DESTINATIONS: NavDestination[] = [
  { key: 'dashboard', href: '/app/dashboard', labelKey: 'nav.dashboard', mark: '⌂', primary: true },
  { key: 'calendar', href: '/app/calendar', labelKey: 'nav.calendar', mark: '▤', primary: true },
  {
    key: 'appointments',
    href: '/app/appointments',
    labelKey: 'nav.appointments',
    mark: '≡',
    primary: true,
  },
  { key: 'services', href: '/app/services', labelKey: 'nav.services', mark: '✂', primary: true },
  {
    key: 'availability',
    href: '/app/availability',
    labelKey: 'nav.availability',
    mark: '◷',
    primary: false,
  },
  {
    key: 'notifications',
    href: '/app/notifications',
    labelKey: 'nav.notifications',
    mark: '✉',
    primary: false,
  },
  { key: 'settings', href: '/app/settings', labelKey: 'nav.settings', mark: '⚙', primary: false },
];

/** True when this destination owns the current route, nested screens included. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True when the viewport is wide enough for a sidebar beside the content. */
export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return width >= BREAKPOINT_DESKTOP;
}

/** The sidebar, for a screen with room for one. */
export function WorkspaceSidebar({ businessName }: { businessName: string }) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const pathname = usePathname();

  return (
    <View
      role="navigation"
      accessibilityLabel={t('nav.sections')}
      style={{
        width: 232,
        paddingVertical: spacing.lg,
        paddingHorizontal: spacing.md,
        gap: spacing.xs,
        borderRightWidth: 1,
        borderRightColor: palette.border,
        backgroundColor: palette.surface,
      }}
    >
      <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.md, gap: 2 }}>
        <Text variant="overline" tone="muted">
          {t('nav.workspace')}
        </Text>
        <Text variant="label" numberOfLines={2}>
          {businessName}
        </Text>
      </View>

      {DESTINATIONS.map((destination, index) => {
        const active = isActive(pathname, destination.href);
        // A quiet rule between the daily work and the configuration below it.
        const startsConfiguration = !destination.primary && DESTINATIONS[index - 1]?.primary;

        return (
          <View key={destination.key}>
            {startsConfiguration && (
              <View
                style={{
                  height: 1,
                  marginVertical: spacing.sm,
                  marginHorizontal: spacing.sm,
                  backgroundColor: palette.borderSubtle,
                }}
              />
            )}

            <PressableLink
              href={destination.href}
              accessibilityLabel={t(destination.labelKey)}
              current={active}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                minHeight: 44,
                paddingHorizontal: spacing.sm,
                borderRadius: radius.sm,
                backgroundColor: active ? palette.accentMuted : 'transparent',
              }}
            >
              <Text
                variant="body"
                accessibilityElementsHidden
                style={{
                  width: 20,
                  textAlign: 'center',
                  color: active ? palette.accent : palette.textMuted,
                }}
              >
                {destination.mark}
              </Text>
              <Text
                variant="label"
                numberOfLines={1}
                style={{ color: active ? palette.accent : palette.text }}
              >
                {t(destination.labelKey)}
              </Text>
            </PressableLink>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The phone's bottom bar: four destinations and a way to the rest.
 *
 * It sits above the home indicator, and it is the reason every screen under
 * `/app` reserves room at the bottom -- a sticky bar that covers the last row
 * of a list is worse than no bar.
 */
export function WorkspaceTabBar() {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const primary = DESTINATIONS.filter((destination) => destination.primary);
  const overflow = DESTINATIONS.filter((destination) => !destination.primary);
  const inOverflow = overflow.some((destination) => isActive(pathname, destination.href));

  const tabs: { key: string; href: string; label: string; mark: string; active: boolean }[] = [
    ...primary.map((destination) => ({
      key: destination.key,
      href: destination.href,
      label: t(destination.labelKey),
      mark: destination.mark,
      active: isActive(pathname, destination.href),
    })),
    {
      key: 'more',
      // *Más* is settings plus a visible list of the other configuration
      // screens; see the workspace header.
      href: '/app/more',
      label: t('nav.more'),
      mark: '⋯',
      active: inOverflow || pathname === '/app/more',
    },
  ];

  return (
    <View
      role="navigation"
      accessibilityLabel={t('nav.sections')}
      style={{
        flexDirection: 'row',
        paddingBottom: insets.bottom,
        borderTopWidth: 1,
        borderTopColor: palette.border,
        backgroundColor: palette.surface,
      }}
    >
      {tabs.map((tab) => (
        <View key={tab.key} style={{ flex: 1 }}>
          <PressableLink
            href={tab.href}
            accessibilityLabel={tab.label}
            current={tab.active}
            style={{
              minHeight: 56,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              paddingVertical: spacing.xs,
            }}
          >
            <Text
              variant="body"
              accessibilityElementsHidden
              style={{ color: tab.active ? palette.accent : palette.textMuted }}
            >
              {tab.mark}
            </Text>
            <Text
              variant="caption"
              numberOfLines={1}
              style={{
                fontSize: 11,
                color: tab.active ? palette.accent : palette.textMuted,
                fontWeight: tab.active ? '700' : '400',
              }}
            >
              {tab.label}
            </Text>
          </PressableLink>
        </View>
      ))}
    </View>
  );
}
