import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorSurface } from '@/components/error-surface';
import { LocaleProvider, SessionProvider, WorkspaceProvider } from '@/components/providers';
import '@/i18n';
import { useTheme } from '@/theme';

/**
 * Expo Router renders this instead of the tree when a render throws.
 *
 * Exported from the root layout, so it covers every screen in the product:
 * without it, the web build shows a blank page and native shows a red one.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  // Providers deliberately: the surface is translated, and the language has to
  // resolve even when whatever failed was further in.
  return (
    <SafeAreaProvider>
      <LocaleProvider>
        <ErrorSurface error={error} retry={retry} />
      </LocaleProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  const { palette, isDark } = useTheme();

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <LocaleProvider>
          <WorkspaceProvider>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            {/* The document title: the browser tab, the bookmark, the history
              entry, and the first thing a screen reader announces on every
              page. Without it the export ships `<title></title>` on every
              route -- an accessibility failure, and a row of blank tabs.

              `Stack`'s `title` option does not reach it here, because no
              screen shows a header for that option to belong to. This does. */}
            <Head>
              <title>Booking Platform</title>
            </Head>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: palette.background },
              }}
            />
          </WorkspaceProvider>
        </LocaleProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
