import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LocaleProvider, SessionProvider, WorkspaceProvider } from '@/components/providers';
import '@/i18n';
import { useTheme } from '@/theme';

export default function RootLayout() {
  const { palette, isDark } = useTheme();

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <LocaleProvider>
          <WorkspaceProvider>
          <StatusBar style={isDark ? 'light' : 'dark'} />
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
