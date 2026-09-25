import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { Card, PressableLink, Text } from '@/components/ui';
import { DESTINATIONS } from '@/components/workspace-nav';
import { WorkspaceShell } from '@/components/workspace-shell';
import { radius, spacing, useTheme } from '@/theme';

/**
 * The configuration screens, on a phone.
 *
 * Four destinations fit in a bottom bar and stay hittable; seven do not. The
 * three that are visited when something changes rather than several times a
 * day live here, where they are a list with room for a line of explanation
 * each -- which is more useful than three more unlabelled icons would be.
 *
 * On a desk this screen is reachable but redundant: the sidebar already shows
 * everything at once.
 */
export default function MoreScreen() {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const { business, professional } = useRequiredWorkspace();

  const hints: Record<string, string> = {
    availability: t('setup.stepScheduleHint'),
    notifications: t('notifications.subtitle'),
    settings: t('settings.subtitle'),
  };

  return (
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      title={t('nav.more')}
      narrow
    >
      <Card>
        <View style={{ gap: spacing.sm }}>
          {DESTINATIONS.filter((destination) => !destination.primary).map((destination) => (
            <PressableLink
              key={destination.key}
              href={destination.href}
              accessibilityLabel={t(destination.labelKey)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                minHeight: 56,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              }}
            >
              <Text
                variant="heading"
                accessibilityElementsHidden
                style={{ width: 24, textAlign: 'center', color: palette.accent }}
              >
                {destination.mark}
              </Text>
              <View style={{ flex: 1, gap: 1 }}>
                <Text variant="label">{t(destination.labelKey)}</Text>
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {hints[destination.key] ?? ''}
                </Text>
              </View>
              <Text variant="body" tone="muted" accessibilityElementsHidden>
                {'›'}
              </Text>
            </PressableLink>
          ))}
        </View>
      </Card>
    </WorkspaceShell>
  );
}
