import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useRequiredWorkspace } from '@/components/providers';
import { RoadmapNote } from '@/components/roadmap-note';
import { Button, Card, Feedback, Screen, Text } from '@/components/ui';
import { publicBookingUrl } from '@/lib/env';
import { signOut } from '@/services/auth';
import { spacing } from '@/theme';

const SECTIONS = [
  { href: '/app/calendar', label: 'Calendar' },
  { href: '/app/appointments', label: 'Appointments' },
  { href: '/app/services', label: 'Services' },
  { href: '/app/availability', label: 'Availability' },
  { href: '/app/settings', label: 'Settings' },
];

export default function DashboardScreen() {
  const { business, professional } = useRequiredWorkspace();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const link = publicBookingUrl(business.slug);

  return (
    <Screen title={business.name} subtitle={professional?.displayName ?? undefined}>
      <Card>
        <Text variant="label">Your booking link</Text>
        <Text variant="body" tone="accent" selectable>
          {link}
        </Text>
        {business.isPublished ? (
          <Text variant="caption" tone="success">
            Published. Anyone with this link can book.
          </Text>
        ) : (
          <Feedback
            tone="muted"
            message="Not published yet. Publish it from Settings when you are ready."
          />
        )}
        <Link href={`/p/${business.slug}`} asChild>
          <Button label="Open my public page" variant="secondary" />
        </Link>
      </Card>

      <View style={{ gap: spacing.sm }}>
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} asChild>
            <Button label={section.label} variant="secondary" />
          </Link>
        ))}
      </View>

      <RoadmapNote
        phase="Phase 4 - Professional Calendar"
        summary="Today's appointments, the next one up, anything still pending, and a one-tap block land here."
      />

      <Button
        label="Sign out"
        variant="ghost"
        loading={signingOut}
        onPress={async () => {
          setSigningOut(true);
          try {
            await signOut();
            router.replace('/login');
          } finally {
            setSigningOut(false);
          }
        }}
      />
    </Screen>
  );
}
