import { afterEach, describe, expect, it } from 'vitest';

import {
  InvalidEnvError,
  MissingEnvError,
  environmentName,
  getEnv,
  isConfigured,
  publicBookingUrl,
} from '@/lib/env';

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
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_abcdefghijklmnop';
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

describe('configuration that is present but wrong', () => {
  const GOOD_KEY = 'sb_publishable_abcdefghijklmnop';

  it('refuses a URL that is not a project URL', () => {
    // The expensive failure this prevents: a URL that is merely wrong connects
    // to somebody else's project and the app looks like it works.
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = GOOD_KEY;

    for (const url of [
      'example.supabase.co',
      'http://example.supabase.co',
      'https://supabase.com/dashboard/project/example',
      'https://example.com',
    ]) {
      process.env.EXPO_PUBLIC_SUPABASE_URL = url;
      expect(() => getEnv(), url).toThrow(InvalidEnvError);
    }
  });

  it('refuses a key that is not a publishable key', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';

    for (const key of ['anon-key', 'sb_secret_abcdefghijklmnop', 'eyJ.short']) {
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = key;
      expect(() => getEnv(), key).toThrow(InvalidEnvError);
    }
  });

  it('accepts both key formats Supabase issues', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';

    for (const key of [GOOD_KEY, 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlXw']) {
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = key;
      expect(() => getEnv(), key).not.toThrow();
    }
  });

  it('never puts a value in the message, only the name', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'sb_secret_should_never_be_echoed';

    expect(() => getEnv()).toThrow(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
    expect(() => getEnv()).not.toThrow(/should_never_be_echoed/);
  });
});

describe('environmentName', () => {
  it('names the project this build talks to', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co';
    expect(environmentName()).toBe('abcdefghijklmnop');
  });

  it('says so when nothing is configured', () => {
    expect(environmentName()).toBe('unconfigured');
  });

  /**
   * This branch used to be unreachable. The project-reference pattern it sat
   * behind only matches `*.supabase.co`, so a loopback URL fell through to
   * 'unknown' and the diagnostics screen never once said 'local'.
   */
  it('recognises a stack running on this machine', () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:4301', 'http://127.0.0.1']) {
      process.env.EXPO_PUBLIC_SUPABASE_URL = url;
      expect(environmentName(), url).toBe('local');
    }
  });
});

describe('a stack running on this machine', () => {
  const KEY = 'sb_publishable_abcdefghijklmnop';

  it('is accepted, so the end-to-end suite needs no cloud project', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = KEY;

    expect(getEnv().supabaseUrl).toBe('http://127.0.0.1:54321');
  });

  it('is the only exception: any other host still has to be a project over TLS', () => {
    for (const url of [
      'http://example.com',
      'http://192.168.1.10:54321',
      'http://127.0.0.1.evil.test',
      'https://127.0.0.1:54321',
      'http://127.0.0.1:54321/rest',
    ]) {
      process.env.EXPO_PUBLIC_SUPABASE_URL = url;
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = KEY;
      expect(() => getEnv(), url).toThrow(InvalidEnvError);
    }
  });

  it('never becomes a way to smuggle a plain-HTTP production URL in', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://myproject.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = KEY;

    expect(() => getEnv()).toThrow(InvalidEnvError);
  });
});
