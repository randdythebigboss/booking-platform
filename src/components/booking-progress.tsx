import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { BOOKING_STEPS, stepIndex, type BookingStep } from '@/features/booking';
import { radius, spacing, useTheme } from '@/theme';

export interface BookingProgressProps {
  step: BookingStep;
}

/**
 * How far through the booking somebody is.
 *
 * The five cards below already count themselves -- *1. Choose a service* --
 * but a number on a heading you have scrolled past is not an answer to "how
 * much of this is left?". On a phone that question decides whether somebody
 * finishes, and the honest answer is short: five steps, you are on the third.
 *
 * The bar is decorative; the sentence above it is what is announced, and it
 * names the step rather than leaving a screen reader to say "60 percent".
 */
export function BookingProgress({ step }: BookingProgressProps) {
  const { palette } = useTheme();
  const { t } = useTranslation();

  const current = stepIndex(step) + 1;
  const total = BOOKING_STEPS.length;

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" tone="muted">
        {t('booking.stepOf', { current, total })} {'·'} {t(`booking.step_${step}` as const)}
      </Text>
      <View
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: 'row', gap: 4 }}
      >
        {BOOKING_STEPS.map((entry, position) => (
          <View
            key={entry}
            style={{
              flex: 1,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: position < current ? palette.accent : palette.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}
