import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import { isConfigured } from '@/lib/env';
import { spacing } from '@/theme';

export default function LandingScreen() {
  const { t } = useTranslation();
  const configured = isConfigured();

  return (
    <Screen title={t('landing.title')} subtitle={t('landing.subtitle')}>
      <View style={{ gap: spacing.md }}>
        <Link href="/login" asChild>
          <Button label={t('landing.professionalCta')} />
        </Link>
        <Link href="/p/demo-studio" asChild>
          <Button label={t('landing.exploreDemo')} variant="secondary" />
        </Link>
      </View>

      <Card>
        <Text variant="heading">{t('landing.forProfessionals')}</Text>
        <Text variant="body" tone="muted">
          {t('landing.forProfessionalsBody')}
        </Text>
      </Card>

      <Card>
        <Text variant="heading">{t('landing.forCustomers')}</Text>
        <Text variant="body" tone="muted">
          {t('landing.forCustomersBody')}
        </Text>
      </Card>

      {!configured && (
        <Card>
          <Text variant="heading" tone="danger">
            {t('auth.notConfigured')}
          </Text>
          <Text variant="caption" tone="muted">
            {t('auth.notConfiguredBody')}
          </Text>
        </Card>
      )}
    </Screen>
  );
}
