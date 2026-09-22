import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { tokenFromUrl, upgradeLegacyTokenUrl } from '@/features/booking';

/**
 * The guest's booking credential, taken from the URL fragment.
 *
 * Three sources, in order, because the same screen has to work in three
 * situations:
 *
 *   * web, where the fragment is `window.location.hash` and never reaches a
 *     server;
 *   * native, where a deep link arrives whole and `Linking.useURL()` is the
 *     only thing that carries the fragment -- `useLocalSearchParams` drops it;
 *   * a link shared before this change, which still has `?token=`.
 *
 * On web a legacy query token is rewritten to the fragment form immediately,
 * with `replaceState` rather than a push, so the credential leaves the address
 * bar and cannot be recovered with the Back button.
 *
 * `null` means "not yet resolved"; `''` means "definitely absent". The
 * difference matters: rendering "you need your link" while the fragment is
 * still being read would be wrong on every first paint.
 */
export function useGuestToken(): string | null | '' {
  const params = useLocalSearchParams<{ token?: string }>();
  const nativeUrl = Linking.useURL();
  const [token, setToken] = useState<string | null | ''>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location) {
      const upgraded = upgradeLegacyTokenUrl(window.location.href);
      if (upgraded && window.history?.replaceState) {
        window.history.replaceState(null, '', upgraded);
      }
      setToken(tokenFromUrl(window.location.href) ?? params.token ?? '');
      return;
    }

    // Native: the deep link is the only place the fragment survives.
    setToken(tokenFromUrl(nativeUrl) ?? params.token ?? '');
  }, [nativeUrl, params.token]);

  return token;
}
