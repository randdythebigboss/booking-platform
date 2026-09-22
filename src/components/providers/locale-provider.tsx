import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { detectDeviceLocale } from '@/i18n/device-locale';
import i18n from '@/i18n';
import { readStoredLocale, writeStoredLocale } from '@/i18n/locale-storage';
import { DEFAULT_LOCALE, type Locale } from '@/locales';
import { fetchPreferredLocale, savePreferredLocale } from '@/services/locale';

import { useSession } from './session-provider';

export interface LocaleValue {
  locale: Locale;
  /** False until the resolved language has been applied. */
  ready: boolean;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleValue>({
  locale: DEFAULT_LOCALE,
  ready: false,
  setLocale: () => {},
});

/**
 * Decides what language the app speaks, in this order:
 *
 *   1. what this person explicitly chose  (their profile when signed in,
 *      otherwise this device's stored choice)
 *   2. what the device asks for, if the product speaks it
 *   3. Spanish
 *
 * Spanish is the fallback everywhere. A Japanese browser gets Spanish, not
 * English -- English is merely the other language, not the default.
 *
 * **Nothing here runs during the first render.** i18next starts in Spanish
 * synchronously, and the resolved language is applied in an effect. On web
 * that is what keeps the statically rendered HTML and the first client render
 * identical; on native the effect runs before anything is visible.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.user?.id ?? null;

  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  // Step one, on mount: this device's stored choice, else what it asks for.
  useEffect(() => {
    let cancelled = false;

    readStoredLocale()
      .then((stored) => {
        if (cancelled) return;
        apply(stored ?? detectDeviceLocale());
      })
      .catch(() => {
        if (!cancelled) apply(detectDeviceLocale());
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Step two, once there is a session: the choice that belongs to the person
  // rather than to the device. It wins, so signing in on a second device does
  // not quietly revert someone to Spanish.
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    fetchPreferredLocale()
      .then((preferred) => {
        if (!cancelled && preferred) apply(preferred);
      })
      .catch(() => {
        // Not being able to read a preference is not worth surfacing; the
        // device's answer is already applied and is a reasonable one.
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  function apply(next: Locale) {
    setLocaleState(next);
    if (i18n.language !== next) void i18n.changeLanguage(next);

    // Keep the document in step on web. The static export ships lang="es",
    // and leaving it there while the interface reads English tells a screen
    // reader to pronounce English words with Spanish phonetics.
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next;
    }
  }

  const setLocale = useCallback(
    (next: Locale) => {
      apply(next);
      void writeStoredLocale(next);
      // Signed in, so the choice is theirs and not this browser's. A failure
      // here leaves the device copy in place, which is the graceful outcome.
      if (userId) void savePreferredLocale(userId, next).catch(() => {});
    },
    [userId],
  );

  const value = useMemo<LocaleValue>(
    () => ({ locale, ready, setLocale }),
    [locale, ready, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}
