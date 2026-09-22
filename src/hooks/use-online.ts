import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Whether the device thinks it can reach the network.
 *
 * Scheduling is network-authoritative: availability is computed from a live
 * calendar, and a slot that was free two minutes ago may not be. So the
 * product never shows a cached answer as if it were current -- it says it is
 * offline and stops.
 *
 * What this is *not*: a guarantee. `navigator.onLine` reports whether the
 * device has a network interface, not whether Supabase is reachable, so a
 * request can still fail while this says true. That is why it is used to
 * explain a failure and to stop a doomed submit, never as a substitute for
 * handling one.
 *
 * On native there is nothing to read without adding a dependency, so this
 * answers "online" and the request's own failure is what surfaces. A
 * connectivity library is a decision for whenever there is a native build to
 * justify it.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => {
    if (Platform.OS !== 'web') return true;
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
  });

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
