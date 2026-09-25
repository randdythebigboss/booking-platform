/**
 * Design tokens.
 *
 * Deliberately neutral: this product is for tutors, photographers and
 * physiotherapists as much as for barbers, so nothing here should read as
 * belonging to one trade. Blue is the accent because it is the least
 * opinionated colour a business tool can have, and it is a placeholder for a
 * brand nobody has chosen yet.
 *
 * Everything a screen draws comes from here. A screen that reaches for a raw
 * hex value or a magic number is a screen that will drift away from the rest.
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

/**
 * Where the content stops widening.
 *
 * `reading` is for a column of prose or a form -- past about 720px the eye
 * loses the start of the next line. `wide` is for a dashboard or a list, where
 * the extra width buys real information rather than longer lines.
 */
export const maxWidth = {
  reading: 720,
  wide: 1120,
} as const;

/** The width below which the layout is a phone rather than a desk. */
export const BREAKPOINT_DESKTOP = 900;

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** For a number that is the point of its card. */
  metric: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  /** Small, upper-case, for a section label above a group. */
  overline: { fontSize: 11, lineHeight: 16, fontWeight: '700', letterSpacing: 0.8 },
} as const;

export type TypographyVariant = keyof typeof typography;

export interface Palette {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  /** A hairline, for dividing rows inside one surface. */
  borderSubtle: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  /** A wash of the accent, for a selected row or a quiet highlight. */
  accentMuted: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  /** Behind a modal or a sheet. */
  scrim: string;
}

export const lightPalette: Palette = {
  background: '#F6F7FB',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F2F6',
  border: '#E2E4EC',
  borderSubtle: '#EEF0F5',
  text: '#15171C',
  textMuted: '#5F6472',
  accent: '#2F5BEA',
  accentText: '#FFFFFF',
  accentMuted: '#EAEFFE',
  success: '#0F6E43',
  successMuted: '#E3F5EC',
  warning: '#8A5800',
  warningMuted: '#FBF0DC',
  danger: '#B3261E',
  dangerMuted: '#FBE9E7',
  scrim: 'rgba(12, 14, 20, 0.45)',
};

export const darkPalette: Palette = {
  background: '#0E1014',
  surface: '#171A21',
  surfaceMuted: '#1F232C',
  border: '#2B3038',
  borderSubtle: '#232832',
  text: '#F2F3F7',
  textMuted: '#A2A8B8',
  accent: '#8AA6FF',
  accentText: '#0E1014',
  accentMuted: '#1E2740',
  success: '#5FD39B',
  successMuted: '#16301F',
  warning: '#E8B657',
  warningMuted: '#332713',
  danger: '#F2A29C',
  dangerMuted: '#3A1D1B',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

/**
 * Elevation, as a shadow on web and iOS and as `elevation` on Android.
 *
 * Kept to two steps. A product where everything floats has no hierarchy at
 * all, so `raised` is for something genuinely above the page -- a sheet, a
 * sticky bar -- and `card` is the quiet lift that separates a surface from the
 * background without shouting.
 */
export const elevation = {
  card: {
    shadowColor: '#0B0F1A',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  raised: {
    shadowColor: '#0B0F1A',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;
