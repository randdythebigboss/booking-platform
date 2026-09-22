import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readStoredLocale, writeStoredLocale } from '@/i18n/locale-storage';

/**
 * Where an anonymous guest's language choice lives.
 *
 * AsyncStorage is mocked because the real one needs a platform. What is being
 * tested is the contract around it: a choice survives, junk does not come
 * back, and storage being unavailable never breaks the app -- a private
 * window, blocked site data or a web view mid-teardown all throw here.
 */

const store = new Map<string, string>();
let failing = false;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (failing) throw new Error('site data blocked');
      return store.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      if (failing) throw new Error('site data blocked');
      store.set(key, value);
    },
  },
}));

beforeEach(() => {
  store.clear();
  failing = false;
});

describe('a stored language choice', () => {
  it('comes back the way it went in', async () => {
    await writeStoredLocale('en');
    await expect(readStoredLocale()).resolves.toBe('en');

    await writeStoredLocale('es');
    await expect(readStoredLocale()).resolves.toBe('es');
  });

  it('is null when nothing was ever chosen, so the device gets asked instead', async () => {
    await expect(readStoredLocale()).resolves.toBeNull();
  });

  it('refuses a value the product no longer speaks', async () => {
    // A language removed in a later release, or a tampered-with store.
    store.set('booking-platform.locale', 'ja');
    await expect(readStoredLocale()).resolves.toBeNull();
  });

  it('survives storage that is simply not available', async () => {
    failing = true;
    await expect(readStoredLocale()).resolves.toBeNull();
    // Writing must not throw either: the choice still applies to this session,
    // it just will not outlive a reload.
    await expect(writeStoredLocale('en')).resolves.toBeUndefined();
  });
});
