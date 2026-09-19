import { RoadmapNote } from '@/components/roadmap-note';
import { Screen } from '@/components/ui';

export default function AppointmentsScreen() {
  return (
    <Screen title="Appointments" subtitle="Everything booked, past and future.">
      <RoadmapNote
        phase="Phase 4 - Professional Calendar"
        summary="A filterable list with the status changes that matter: confirm, cancel, complete, no-show."
        items={[
          'Filter by status and date range',
          'Customer contact details',
          'Status transitions write straight to the appointment row',
        ]}
      />
    </Screen>
  );
}
