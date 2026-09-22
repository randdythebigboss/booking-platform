import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

/**
 * Re-reads data when a screen is returned to.
 *
 * Without it, changing an appointment's status and going back leaves the list
 * showing what it said before the change -- the screen is still mounted, so
 * nothing re-runs. Skips the first focus, because the initial load has already
 * happened.
 */
export function useRefreshOnFocus(reload: () => void): void {
  const firstFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      reload();
    }, [reload]),
  );
}
