import AsyncStorage from '@react-native-async-storage/async-storage';

import { isSupportedLocale, type Locale } from '@/locales';

const KEY = 'booking-platform.locale';

/**
 * Where a language choice lives on this device.
 *
 * AsyncStorage rather than localStorage directly: on web it is localStorage,
 * on native it is the platform store, and the app gets one code path. Every
 * call is wrapped, because storage can be unavailable -- a private window, a
 * browser with site data blocked, a web view mid-teardown -- and a language
 * preference is never worth a crash.
 */
export async function readStoredLocale(): Promise<Locale | null> {
  try {
    const value = await AsyncStorage.getItem(KEY);
    return isSupportedLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export async function writeStoredLocale(locale: Locale): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, locale);
  } catch {
    // The choice still applies to this session; it just will not survive a
    // reload. Better than failing the interaction the user actually made.
  }
}
