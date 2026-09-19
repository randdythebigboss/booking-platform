import { Link } from 'expo-router';
import { View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import { isConfigured } from '@/lib/env';
import { spacing } from '@/theme';

export default function LandingScreen() {
  const configured = isConfigured();

  return (
    <Screen
      title="Take bookings without the back-and-forth"
      subtitle="Publish your availability, share one link, and let people book the times you are actually free."
    >
      <View style={{ gap: spacing.md }}>
        <Link href="/login" asChild>
          <Button label="I am a professional" />
        </Link>
        <Link href="/p/demo-studio" asChild>
          <Button label="See a demo booking page" variant="secondary" />
        </Link>
      </View>

      <Card>
        <Text variant="heading">Backend status</Text>
        <Text variant="body" tone={configured ? 'success' : 'danger'}>
          {configured
            ? 'Supabase is configured for this build.'
            : 'Supabase is not configured yet.'}
        </Text>
        {!configured && (
          <Text variant="caption" tone="muted">
            Copy .env.example to .env.local and fill in EXPO_PUBLIC_SUPABASE_URL and
            EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart the dev server.
          </Text>
        )}
      </Card>
    </Screen>
  );
}
