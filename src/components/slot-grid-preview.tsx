import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui';
import { describeGridExample } from '@/features/availability/explain';
import { spacing } from '@/theme';

/**
 * Shows the professional what his chosen grid does, using his own example.
 *
 * The example is fixed on purpose: a 20-minute service booked at 10:30, then
 * somebody wanting 40 minutes. That is the question the field test actually
 * asked, and answering that one concretely is worth more than a paragraph
 * describing grids in general.
 *
 * The numbers come from `describeGridExample`, which runs the real engine.
 * Nothing here is a hand-written table of what we believe the grid does.
 */
export function SlotGridPreview({ slotIntervalMinutes }: { slotIntervalMinutes: number }) {
  const { t } = useTranslation();

  const example = describeGridExample({
    slotIntervalMinutes,
    firstStartClock: '10:30',
    firstServiceMinutes: 20,
    nextServiceMinutes: 40,
  });

  if (!example) return null;

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={t('settings.gridPreviewTitle')}
      style={{ gap: spacing.xs, paddingVertical: spacing.xs }}
    >
      <Text variant="label">{t('settings.gridPreviewTitle')}</Text>
      <Text variant="caption" tone="muted">
        {t('settings.gridPreviewSetup', { end: example.firstEndsClock })}
      </Text>
      {example.nextStartClock === null ? (
        <Text variant="caption" tone="muted">
          {t('settings.gridPreviewNone')}
        </Text>
      ) : (
        <Text variant="caption">
          {t('settings.gridPreviewNext', { start: example.nextStartClock })}
          {example.gapMinutes > 0
            ? ` ${t('settings.gridPreviewGap', { count: example.gapMinutes })}`
            : ` ${t('settings.gridPreviewNoGap')}`}
        </Text>
      )}
    </View>
  );
}
