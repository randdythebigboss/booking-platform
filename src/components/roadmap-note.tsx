import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { spacing } from '@/theme';

export interface RoadmapNoteProps {
  phase: string;
  /** What this screen will do once that phase lands. */
  summary: string;
  items?: string[];
}

/**
 * An honest placeholder.
 *
 * Phase 0 ships the foundation, not the features. Rather than fake a screen
 * with hard-coded data, each route says which phase fills it in. See
 * docs/PRODUCT.md for the full roadmap.
 */
export function RoadmapNote({ phase, summary, items = [] }: RoadmapNoteProps) {
  return (
    <Card>
      <Text variant="label" tone="accent">
        {phase}
      </Text>
      <Text variant="body" tone="muted">
        {summary}
      </Text>
      {items.length > 0 && (
        <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
          {items.map((item) => (
            <Text key={item} variant="caption" tone="muted">
              {'•'} {item}
            </Text>
          ))}
        </View>
      )}
    </Card>
  );
}
