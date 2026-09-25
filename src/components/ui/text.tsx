import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { typography, useTheme, type TypographyVariant } from '@/theme';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: 'default' | 'muted' | 'accent' | 'danger' | 'success';
}

/**
 * Text, in one of the typographic variants, in one of the tones.
 *
 * `title` and `heading` are announced as headings. They looked like headings
 * to everybody reading the screen and were plain text to everybody listening
 * to it, so a screen reader user had no way to jump between the sections of a
 * page -- the whole booking flow was one undifferentiated run of text. The
 * level follows the meaning: `title` is the page, `heading` is a section of it.
 */
export function Text({ variant = 'body', tone = 'default', style, ...rest }: TextProps) {
  const { palette } = useTheme();

  const color =
    tone === 'muted'
      ? palette.textMuted
      : tone === 'accent'
        ? palette.accent
        : tone === 'danger'
          ? palette.danger
          : tone === 'success'
            ? palette.success
            : palette.text;

  const heading =
    variant === 'title'
      ? ({ accessibilityRole: 'header' as const, 'aria-level': 1 } as const)
      : variant === 'heading'
        ? ({ accessibilityRole: 'header' as const, 'aria-level': 2 } as const)
        : null;

  return <RNText style={[typography[variant], { color }, style]} {...heading} {...rest} />;
}
