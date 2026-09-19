import { Link } from 'expo-router';
import { View } from 'react-native';

import { RoadmapNote } from '@/components/roadmap-note';
import { Button, Screen } from '@/components/ui';
import { spacing } from '@/theme';

const SECTIONS = [
  { href: '/app/calendar', label: 'Calendar' },
  { href: '/app/appointments', label: 'Appointments' },
  { href: '/app/services', label: 'Services' },
  { href: '/app/availability', label: 'Availability' },
  { href: '/app/settings', label: 'Settings' },
];

export default function DashboardScreen() {
  return (
    <Screen title="Dashboard" subtitle="Today at a glance.">
      <RoadmapNote
        phase="Phase 4 - Professional Calendar"
        summary="Today's appointments, the next one up, anything still pending, a one-tap block, and the share link for your public page."
      />
      <View style={{ gap: spacing.sm }}>
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} asChild>
            <Button label={section.label} variant="secondary" />
          </Link>
        ))}
      </View>
    </Screen>
  );
}
