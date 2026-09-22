import { Redirect, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useSession, useWorkspace } from '@/components/providers';
import { Button, Card, Screen, Text } from '@/components/ui';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useTheme } from '@/theme';

/**
 * The guard for the professional workspace.
 *
 * It only decides what to render. The real protection is Row Level Security:
 * a signed-out client that reaches these routes anyway simply gets no rows.
 */
export default function WorkspaceLayout() {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const errorText = useWorkspaceErrorText();
  const session = useSession();
  const workspace = useWorkspace();

  if (session.status === 'unconfigured') {
    return (
      <Screen title={t('auth.notConfigured')}>
        <Card>
          <Text variant="body" tone="muted">
            {t('auth.notConfiguredBody')}
          </Text>
        </Card>
      </Screen>
    );
  }

  if (session.status === 'loading' || workspace.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (session.status === 'signed-out') return <Redirect href="/login" />;
  if (workspace.status === 'no-business') return <Redirect href="/onboarding" />;

  if (workspace.status === 'error') {
    return (
      <Screen title={t('common.somethingWentWrong')}>
        <Card>
          <Text variant="body" tone="danger">
            {errorText(workspace.error)}
          </Text>
          {/* Sign-in can race the first read of the business. One press is a
              cheaper way back than signing out and in again. */}
          <Button label={t('common.retry')} onPress={workspace.refresh} />
        </Card>
      </Screen>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
      }}
    />
  );
}
