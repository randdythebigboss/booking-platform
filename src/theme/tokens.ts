/**
 * Design tokens.
 *
 * Deliberately neutral: this product is for tutors, photographers and
 * physiotherapists as much as for barbers, so nothing here should read as
 * belonging to one trade.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

/** Minimum comfortable touch target, in density-independent pixels. */
export const TOUCH_TARGET = 48;

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
} as const;

export type TypographyVariant = keyof typeof typography;

export interface Palette {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  success: string;
  warning: string;
  danger: string;
}

export const lightPalette: Palette = {
  background: '#FBFBFD',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F2F6',
  border: '#E2E4EC',
  text: '#15171C',
  textMuted: '#5F6472',
  accent: '#2F5BEA',
  accentText: '#FFFFFF',
  success: '#127C4B',
  warning: '#9A6200',
  danger: '#B3261E',
};

export const darkPalette: Palette = {
  background: '#0E1014',
  surface: '#171A21',
  surfaceMuted: '#1F232C',
  border: '#2B3038',
  text: '#F2F3F7',
  textMuted: '#A2A8B8',
  accent: '#8AA6FF',
  accentText: '#0E1014',
  success: '#5FD39B',
  warning: '#E8B657',
  danger: '#F2A29C',
};
