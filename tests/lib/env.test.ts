import { afterEach, describe, expect, it } from 'vitest';

import { MissingEnvError, getEnv, isConfigured, publicBookingUrl } from '@/lib/env';

const KEYS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_SITE_URL',
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('isConfigured', () => {
  it('needs both the URL and the anon key', () => {
    expect(isConfigured()).toBe(false);

    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    expect(isConfigured()).toBe(false);

    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    expect(isConfigured()).toBe(true);
  });

  it('treats an empty string as absent', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = '';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    expect(isConfigured()).toBe(false);
  });
});

describe('getEnv', () => {
  it('names every variable that is missing', () => {
    expect(() => getEnv()).toThrow(MissingEnvError);
    expect(() => getEnv()).toThrow(/EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('defaults the site URL for local development', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    expect(getEnv().siteUrl).toBe('http://localhost:8081');
  });
});

describe('publicBookingUrl', () => {
  it('builds the shareable link without doubling the slash', () => {
    expect(publicBookingUrl('demo-studio', 'https://app.example.com/')).toBe(
      'https://app.example.com/p/demo-studio',
    );
  });
});
