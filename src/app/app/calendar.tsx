import { RoadmapNote } from '@/components/roadmap-note';
import { Screen } from '@/components/ui';

export default function CalendarScreen() {
  return (
    <Screen title="Calendar" subtitle="Your day, your week, in your own timezone.">
      <RoadmapNote
        phase="Phase 4 - Professional Calendar"
        summary="Day and week views built on the same availability engine the booking page uses, so what you see and what customers can book can never drift apart."
        items={['Day and week views', 'Tap an appointment for detail', 'Drag to block time']}
      />
    </Screen>
  );
}
