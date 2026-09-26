import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAuthCapabilities, resetAuthCapabilitiesCache } from '@/features/auth/capabilities';

/**
 * The screens ask the Auth server whether an account can be created, rather
 * than carrying an opinion about it.
 *
 * The direction of the default matters more than it looks. Hiding a working
 * sign-up form because one request timed out has no recovery -- the person
 * simply cannot make an account and nothing tells them why. Showing a form
 * the server then refuses does have one: `SIGNUP_DISABLED` says so in their
 * own language. So an unknown answer means "available", and the server stays
 * the boundary either way.
 */
describe('fetchAuthCapabilities', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetAuthCapabilitiesCache();
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    // Shaped like a real publishable key, because getEnv validates it.
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_fixture_key_0123456789';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetAuthCapabilitiesCache();
  });

  const reply = (body: unknown, ok = true) =>
    vi.fn().mockResolvedValue({ ok, json: async () => body } as unknown as Response);

  it('reports sign-up closed when the project has disabled it', async () => {
    globalThis.fetch = reply({ disable_signup: true, mailer_autoconfirm: true });
    await expect(fetchAuthCapabilities()).resolves.toEqual({ signUpEnabled: false });
  });

  it('reports sign-up open when the project allows it', async () => {
    globalThis.fetch = reply({ disable_signup: false });
    await expect(fetchAuthCapabilities()).resolves.toEqual({ signUpEnabled: true });
  });

  it('treats anything other than a literal true as open', async () => {
    // GoTrue answers with a boolean; a proxy or a future version might not.
    // Only an explicit `true` closes the form.
    globalThis.fetch = reply({ disable_signup: 'true' });
    await expect(fetchAuthCapabilities()).resolves.toEqual({ signUpEnabled: true });
  });

  it('stays open when the setting cannot be read at all', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchAuthCapabilities()).resolves.toEqual({ signUpEnabled: true });
  });

  it('stays open rather than throwing when the app is unconfigured', async () => {
    // A fresh clone with no .env.local must still render a sign-in screen.
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    resetAuthCapabilitiesCache();
    await expect(fetchAuthCapabilities()).resolves.toEqual({ signUpEnabled: true });
  });

  it('stays open when the endpoint answers with an error status', async () => {
    globalThis.fetch = reply({}, false);
    await expect(fetchAuthCapabilities()).resolves.toEqual({ signUpEnabled: true });
  });

  it('asks once, because a project is not reconfigured mid-form', async () => {
    const spy = reply({ disable_signup: true });
    globalThis.fetch = spy;

    await Promise.all([fetchAuthCapabilities(), fetchAuthCapabilities()]);
    await fetchAuthCapabilities();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sends the anon key and nothing else', async () => {
    const spy = reply({ disable_signup: false });
    globalThis.fetch = spy;
    await fetchAuthCapabilities();

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.supabase.co/auth/v1/settings');
    expect(init.headers).toEqual({ apikey: 'sb_publishable_fixture_key_0123456789' });
  });
});
