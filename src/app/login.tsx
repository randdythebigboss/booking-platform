import { Link } from 'expo-router';

import { RoadmapNote } from '@/components/roadmap-note';
import { Button, Screen } from '@/components/ui';

export default function LoginScreen() {
  return (
    <Screen title="Sign in" subtitle="One account manages every business you work with.">
      <RoadmapNote
        phase="Phase 1 - Professional Setup"
        summary="Email and password authentication against Supabase Auth, then straight into onboarding for a first-time user."
        items={[
          'Email + password sign in and sign up',
          'Session persisted with AsyncStorage on native, localStorage on web',
          'Redirect to /onboarding when the account has no business yet',
        ]}
      />
      <Link href="/onboarding" asChild>
        <Button label="Preview onboarding" variant="secondary" />
      </Link>
    </Screen>
  );
}
