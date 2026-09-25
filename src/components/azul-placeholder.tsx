import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Feedback, Text } from '@/components/ui';
import { spacing } from '@/theme';

/**
 * Where card payment through Azul will go, and an honest account of the fact
 * that it is not there.
 *
 * ---------------------------------------------------------------------------
 * What this must never do
 * ---------------------------------------------------------------------------
 *
 * Look like it works. There is no gateway behind it, no merchant account, no
 * token, no redirect and no request. Pressing it opens a sentence saying so.
 *
 * A fake gateway that "succeeds" would be worse than having nothing: somebody
 * would believe they had paid. So the button exists to show where the
 * capability is going, and says plainly that it has not arrived -- which is
 * also the honest answer to a professional asking whether they can take cards
 * yet.
 *
 * Connecting Azul for real needs a merchant relationship that costs money and
 * has to be signed by the business itself. That is a Product Owner decision,
 * not an engineering one, and nothing here quietly starts it.
 */
export function AzulPlaceholder({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [explained, setExplained] = useState(false);

  const explanation = (
    <View style={{ gap: spacing.xs }}>
      <Text variant="label">{t('azul.title')}</Text>
      <Text variant="body" tone="muted">
        {t('azul.body')}
      </Text>
      {/* The sentence that matters most on a screen with a pay button. */}
      <Feedback tone="muted" message={t('azul.noCharge')} />
      <Text variant="caption" tone="muted">
        {t('azul.forNow')}
      </Text>
      <Button
        label={t('azul.understood')}
        variant="secondary"
        onPress={() => setExplained(false)}
      />
    </View>
  );

  if (compact) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Button
          label={t('azul.payWithAzul')}
          variant="secondary"
          onPress={() => setExplained(true)}
        />
        {explained && explanation}
      </View>
    );
  }

  // On Settings the reader is the professional, not a customer. "Pay with
  // Azul" was a customer's button on a professional's screen, and pressing it
  // to be told nothing is charged made no sense to the person it was shown to.
  // What they want to know is whether they can connect their own account yet.
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="body" tone="muted">
        {t('azul.settingsBody')}
      </Text>
      <Text variant="caption" tone="muted">
        {t('azul.connectHint')}
      </Text>
      <View style={{ flexDirection: 'row' }}>
        <Button
          label={t('azul.connect')}
          variant="secondary"
          size="compact"
          disabled
          onPress={() => undefined}
        />
      </View>
    </View>
  );
}
