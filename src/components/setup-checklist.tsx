import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { radius, spacing, useTheme } from '@/theme';

export interface SetupStep {
  key: 'business' | 'services' | 'schedule' | 'review' | 'share';
  done: boolean;
  href: string;
}

export interface SetupChecklistProps {
  steps: SetupStep[];
  onDismiss?: () => void;
}

/**
 * The order a professional does things in, said out loud.
 *
 * Every one of these screens already existed and every one was reachable, and
 * a person opening the product for the first time still had to work out that
 * hours are useless without services and that neither matters until the page
 * is published. Capability is not the same as knowing what to do first.
 *
 * It disappears once the five are done, because a checklist of things you have
 * already finished is clutter on the screen you look at every morning.
 */
export function SetupChecklist({ steps, onDismiss }: SetupChecklistProps) {
  const { palette } = useTheme();
  const { t } = useTranslation();

  const done = steps.filter((step) => step.done).length;
  const complete = done === steps.length;

  const titles: Record<SetupStep['key'], string> = {
    business: t('setup.stepBusiness'),
    services: t('setup.stepServices'),
    schedule: t('setup.stepSchedule'),
    review: t('setup.stepReview'),
    share: t('setup.stepShare'),
  };

  const hints: Record<SetupStep['key'], string> = {
    business: t('setup.stepBusinessHint'),
    services: t('setup.stepServicesHint'),
    schedule: t('setup.stepScheduleHint'),
    review: t('setup.stepReviewHint'),
    share: t('setup.stepShareHint'),
  };

  return (
    <Card>
      <Text variant="heading">{t('setup.title')}</Text>
      <Text variant="body" tone="muted">
        {complete ? t('setup.allDone') : t('setup.subtitle')}
      </Text>
      <Text variant="caption" tone="accent">
        {t('setup.progress', { done, total: steps.length })}
      </Text>

      <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
        {steps.map((step, index) => (
          <Link key={step.key} href={step.href} asChild>
            <View
              accessibilityRole="link"
              // The number, the name and the state, so a screen reader gives
              // the same information the layout gives everyone else.
              accessibilityLabel={`${index + 1}. ${titles[step.key]} — ${
                step.done ? t('setup.done') : t('setup.pending')
              }`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                minHeight: 44,
                padding: spacing.sm,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: step.done ? palette.border : palette.accent,
                backgroundColor: step.done ? 'transparent' : palette.surfaceMuted,
                opacity: step.done ? 0.65 : 1,
              }}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: step.done ? palette.accent : 'transparent',
                  borderWidth: 1,
                  borderColor: step.done ? palette.accent : palette.border,
                }}
              >
                <Text
                  variant="caption"
                  style={{ color: step.done ? palette.accentText : palette.textMuted }}
                >
                  {step.done ? '✓' : String(index + 1)}
                </Text>
              </View>

              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label">{titles[step.key]}</Text>
                <Text variant="caption" tone="muted">
                  {hints[step.key]}
                </Text>
              </View>
            </View>
          </Link>
        ))}
      </View>

      {complete && onDismiss && (
        <Button label={t('setup.hide')} variant="secondary" onPress={onDismiss} />
      )}
    </Card>
  );
}
