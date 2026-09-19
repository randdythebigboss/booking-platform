import { RoadmapNote } from '@/components/roadmap-note';
import { Screen } from '@/components/ui';

export default function AvailabilityScreen() {
  return (
    <Screen title="Availability" subtitle="Working hours, days off, and one-off changes.">
      <RoadmapNote
        phase="Phase 1 and Phase 2"
        summary="Weekly hours per weekday, plus exceptions for a single date and ad-hoc blocks. Availability is never stored as a list of free slots -- it is computed from these rules every time."
        items={[
          'Weekly schedule per weekday',
          'Close a whole day, or just part of one',
          'Open a date that is normally closed',
          'Block time without cancelling anything',
        ]}
      />
    </Screen>
  );
}
