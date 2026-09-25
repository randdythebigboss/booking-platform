import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

export interface PressableLinkProps {
  href: string;
  accessibilityLabel: string;
  /** Marks the destination the user is already on. */
  current?: boolean;
  style: ViewStyle;
  children: ReactNode;
}

/**
 * A link that is also a box with a layout.
 *
 * ---------------------------------------------------------------------------
 * The bug this exists to stop repeating
 * ---------------------------------------------------------------------------
 *
 * `<Link asChild><Pressable style={({ pressed }) => ({ ... })}>` looks
 * completely reasonable and, on the web, throws the style away. `asChild`
 * merges the child's props onto the anchor React Native Web renders, and a
 * style *function* is not a style -- so the anchor keeps its default
 * `flex-direction: column` and none of the padding, height, border or
 * background arrives.
 *
 * It fails silently and it looks like a design problem rather than a bug:
 * appointment rows had no card around them for three phases, and the sidebar's
 * icons sat above their labels instead of beside them. Both were this.
 *
 * So: a plain object, always, and the layout on an inner `View` that cannot be
 * flattened away regardless. Pressed feedback is deliberately not here --
 * these navigate immediately, and a highlight nobody sees is not worth a
 * footgun.
 */
export function PressableLink({
  href,
  accessibilityLabel,
  current,
  style,
  children,
}: PressableLinkProps) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={current ? { selected: true } : undefined}
        aria-current={current ? 'page' : undefined}
      >
        <View style={style}>{children}</View>
      </Pressable>
    </Link>
  );
}
