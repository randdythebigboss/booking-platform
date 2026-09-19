import { useColorScheme } from '@/hooks/use-color-scheme';

import { darkPalette, lightPalette, type Palette } from './tokens';

export * from './tokens';

export interface Theme {
  palette: Palette;
  isDark: boolean;
}

/** The only place the app decides what light and dark mean. */
export function useTheme(): Theme {
  const isDark = useColorScheme() === 'dark';
  return { palette: isDark ? darkPalette : lightPalette, isDark };
}
