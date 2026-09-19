import { RoadmapNote } from '@/components/roadmap-note';
import { Screen } from '@/components/ui';

export default function ServicesScreen() {
  return (
    <Screen title="Services" subtitle="What you offer, how long it takes, what it costs.">
      <RoadmapNote
        phase="Phase 1 - Professional Setup"
        summary="Create and edit services. Duration and buffers feed the availability engine directly; price and name are snapshotted onto every appointment so history never changes under you."
        items={['Name, description, duration', 'Buffer before and after', 'Price and currency']}
      />
    </Screen>
  );
}
