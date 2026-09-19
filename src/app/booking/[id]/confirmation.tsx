import { useLocalSearchParams } from 'expo-router';

import { RoadmapNote } from '@/components/roadmap-note';
import { Card, Screen, Text } from '@/components/ui';

export default function ConfirmationScreen() {
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();

  return (
    <Screen title="Your appointment" subtitle="Keep this link to manage your booking.">
      <Card>
        <Text variant="label">Appointment</Text>
        <Text variant="body" tone="muted">
          {id}
        </Text>
        {!token && (
          <Text variant="caption" tone="muted">
            This page needs the access token issued at booking time: ?token=...
          </Text>
        )}
      </Card>

      <RoadmapNote
        phase="Phase 3 - Customer Booking"
        summary="Reads the appointment through get_appointment_by_token, so a guest can see and cancel their own booking without ever creating an account -- and without being able to see anyone else's."
        items={[
          'Date, time and service',
          'Where to go',
          'Cancel, while the policy still allows it',
        ]}
      />
    </Screen>
  );
}
