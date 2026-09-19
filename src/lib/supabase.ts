import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { getEnv } from './env';

let client: SupabaseClient | undefined;

/**
 * The single Supabase client for the app, created lazily so that importing
 * this module never throws in an unconfigured environment (tests, CI, a fresh
 * clone before `.env.local` exists).
 *
 * This client always uses the anon key. The service-role key must never reach
 * a bundle -- see docs/SECURITY.md.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const env = getEnv();
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        // On web the session lives in localStorage, which the SDK picks by
        // default; on native it needs an explicit storage adapter.
        ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
        autoRefreshToken: true,
        persistSession: true,
        // Deep-link callbacks are handled by expo-router, not by URL parsing.
        detectSessionInUrl: Platform.OS === 'web',
      },
    });
  }
  return client;
}

/** Test seam: drops the memoised client. */
export function resetSupabase(): void {
  client = undefined;
}
