import { Link } from 'expo-router';

import { RoadmapNote } from '@/components/roadmap-note';
import { Button, Screen } from '@/components/ui';

export default function OnboardingScreen() {
  return (
    <Screen title="Set up your business" subtitle="Four short steps and your booking link is live.">
      <RoadmapNote
        phase="Phase 1 - Professional Setup"
        summary="Creates the business, its public slug and timezone, the first professional profile, and one service, in a single guided flow."
        items={[
          'Business name, public link and IANA timezone',
          'Your professional profile',
          'First service: name, duration, price',
          'Weekly working hours',
        ]}
      />
      <Link href="/app/dashboard" asChild>
        <Button label="Preview the workspace" variant="secondary" />
      </Link>
    </Screen>
  );
}
