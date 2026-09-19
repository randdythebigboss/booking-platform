import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * Web needs its own version.
 *
 * Expo Router static-renders these pages, and the server has no idea what the
 * visitor's system theme is. Returning the real value before hydration would
 * mismatch the server-rendered HTML, so the first paint is always light and
 * the true scheme takes over once React has hydrated.
 */
export function useColorScheme(): 'light' | 'dark' {
  const [hydrated, setHydrated] = useState(false);
  const scheme = useRNColorScheme();

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated) return 'light';
  return scheme === 'dark' ? 'dark' : 'light';
}
