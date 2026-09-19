import { useLocalSearchParams } from 'expo-router';

import { RoadmapNote } from '@/components/roadmap-note';
import { Screen } from '@/components/ui';

export default function BookScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();

  return (
    <Screen
      title="Book an appointment"
      subtitle={`Guest booking for /p/${slug}. No account needed.`}
    >
      <RoadmapNote
        phase="Phase 3 - Customer Booking"
        summary="Service, then date, then a real list of free times, then name and phone. The slots come from the availability engine; the booking itself goes through book_appointment, which is the only thing that can decide who wins a contested time."
        items={[
          'Choose service',
          'Choose date',
          'Choose from times that are genuinely free',
          'Name, phone, optional email',
          'Review and confirm',
        ]}
      />
    </Screen>
  );
}
