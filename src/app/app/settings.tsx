import { RoadmapNote } from '@/components/roadmap-note';
import { Screen } from '@/components/ui';

export default function SettingsScreen() {
  return (
    <Screen title="Settings" subtitle="Your business, your link, your booking rules.">
      <RoadmapNote
        phase="Phase 1 - Professional Setup"
        summary="Business details, the public slug, timezone, and the booking policy the engine enforces."
        items={[
          'Public link and published/unpublished state',
          'IANA timezone',
          'Slot interval, minimum notice, booking horizon',
          'Team members, when a business has more than one professional',
        ]}
      />
    </Screen>
  );
}
