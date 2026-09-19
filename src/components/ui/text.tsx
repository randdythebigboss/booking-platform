import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { typography, useTheme, type TypographyVariant } from '@/theme';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: 'default' | 'muted' | 'accent' | 'danger' | 'success';
}

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

  return <RNText style={[typography[variant], { color }, style]} {...rest} />;
}
