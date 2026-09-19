import { Stack } from 'expo-router';

import { useTheme } from '@/theme';

/**
 * The professional workspace. Everything under /app assumes an authenticated
 * member of at least one business; the auth guard lands here in Phase 1.
 */
export default function WorkspaceLayout() {
  const { palette } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
      }}
    />
  );
}
