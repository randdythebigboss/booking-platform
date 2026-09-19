import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useSession, useWorkspace } from '@/components/providers';
import { Card, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * The guard for the professional workspace.
 *
 * It only decides what to render. The real protection is Row Level Security:
 * a signed-out client that reaches these routes anyway simply gets no rows.
 */
export default function WorkspaceLayout() {
  const { palette } = useTheme();
  const session = useSession();
  const workspace = useWorkspace();

  if (session.status === 'unconfigured') {
    return (
      <Screen title="Workspace">
        <Card>
          <Text variant="heading">Supabase is not configured</Text>
          <Text variant="body" tone="muted">
            Copy .env.example to .env.local and restart the dev server.
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
      <Screen title="Something went wrong">
        <Card>
          <Text variant="body" tone="danger">
            {workspace.error ?? 'Could not load your business.'}
          </Text>
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
