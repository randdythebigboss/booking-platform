import { View } from 'react-native';

import { radius, useTheme } from '@/theme';
import { Text } from './text';

export interface InitialsProps {
  /** A business or a person. Two words at most are used. */
  name: string;
  size?: number;
  /** Quieter, for a row inside a list. */
  tone?: 'accent' | 'neutral';
}

/** The first letters of up to two words, upper-cased. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * A mark for a business or a person, made of their own name.
 *
 * ---------------------------------------------------------------------------
 * Why not a photograph
 * ---------------------------------------------------------------------------
 *
 * The product has no photographs. The alternatives were a stock image, which
 * would be somebody else's shop and quietly dishonest on a page whose whole
 * job is to say who you are, or a generic silhouette, which says less than two
 * letters do and looks like a missing image.
 *
 * Initials are the business's own. They differ between businesses, they carry
 * no false promise, and they cost no bandwidth on a phone on mobile data.
 */
export function Initials({ name, size = 56, tone = 'accent' }: InitialsProps) {
  const { palette } = useTheme();
  const letters = initialsOf(name);

  return (
    <View
      // Decorative: every use of this sits next to the name it was made from,
      // and hearing "E D" before "Estudio Demo" helps nobody.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'accent' ? palette.accentMuted : palette.surfaceMuted,
      }}
    >
      <Text
        style={{
          fontSize: Math.round(size * 0.36),
          lineHeight: Math.round(size * 0.44),
          fontWeight: '700',
          color: tone === 'accent' ? palette.accent : palette.textMuted,
        }}
      >
        {letters}
      </Text>
    </View>
  );
}
