import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import { spacing } from '@/theme';

/**
 * What somebody sees when the application itself fails.
 *
 * Expo Router renders a route's exported `ErrorBoundary` when a render throws,
 * and without one the web build shows a blank page and the native build shows
 * a red screen. Neither tells a customer anything, and both look like the
 * product is gone.
 *
 * What is deliberately not here: the error's message. A React render failure
 * carries whatever threw -- a Supabase error, a SQL string, a stack trace --
 * and this surface is shown to guests. The message goes to the console, where
 * a developer can read it and a customer cannot.
 */
export function ErrorSurface({ error, retry }: { error: Error; retry: () => void }) {
  const { t } = useTranslation();

  // Development keeps its diagnostics: this is the one place the real message
  // is worth having, and __DEV__ is false in every shipped build.
  if (__DEV__) {
    console.error('[ErrorBoundary]', error);
  }

  return (
    <Screen title={t('common.somethingWentWrong')}>
      <Card>
        <Text variant="body">{t('errors.appCrashed')}</Text>
        <View style={{ marginTop: spacing.sm }}>
          <Button label={t('common.retry')} onPress={retry} />
        </View>
      </Card>
    </Screen>
  );
}
