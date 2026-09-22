import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceError } from '@/features/workspace';
import { getCurrentUser, onAuthChange, type AuthUser } from '@/services/auth';

/**
 * What the app does when a token expires, refreshes or is revoked.
 *
 * The local development shim issues real JWTs but implements none of GoTrue's
 * lifecycle, so this is the level at which that behaviour can honestly be
 * tested: the mapping from what the SDK reports to what the app believes. The
 * SDK's own refreshing is not reimplemented here and is not being tested.
 */

type Listener = (event: string, session: unknown) => void;

const listeners: Listener[] = [];
const unsubscribe = vi.fn();
let getSessionResult: { data: { session: unknown }; error: unknown } = {
  data: { session: null },
  error: null,
};

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => getSessionResult,
      onAuthStateChange: (listener: Listener) => {
        listeners.push(listener);
        return { data: { subscription: { unsubscribe } } };
      },
    },
  }),
}));

const SESSION = {
  access_token: 'a.b.c',
  user: { id: 'user-1', email: 'pro@example.test' },
};

beforeEach(() => {
  listeners.length = 0;
  unsubscribe.mockClear();
  getSessionResult = { data: { session: null }, error: null };
});

describe('getCurrentUser', () => {
  it('is nobody when the stored session has expired and could not be refreshed', async () => {
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('is the user the session belongs to', async () => {
    getSessionResult = { data: { session: SESSION }, error: null };
    await expect(getCurrentUser()).resolves.toEqual({
      id: 'user-1',
      email: 'pro@example.test',
    });
  });

  it('turns an auth failure into a workspace error rather than leaking it', async () => {
    getSessionResult = { data: { session: null }, error: { message: 'network unreachable' } };
    await expect(getCurrentUser()).rejects.toBeInstanceOf(WorkspaceError);
  });
});

describe('onAuthChange', () => {
  it('keeps the user signed in across a token refresh', () => {
    const seen: (AuthUser | null)[] = [];
    onAuthChange((user) => seen.push(user));

    listeners[0]?.('TOKEN_REFRESHED', { ...SESSION, access_token: 'd.e.f' });

    expect(seen).toEqual([{ id: 'user-1', email: 'pro@example.test' }]);
  });

  it('signs the user out when the session goes away', () => {
    const seen: (AuthUser | null)[] = [];
    onAuthChange((user) => seen.push(user));

    listeners[0]?.('SIGNED_IN', SESSION);
    listeners[0]?.('SIGNED_OUT', null);

    expect(seen).toEqual([{ id: 'user-1', email: 'pro@example.test' }, null]);
  });

  it('treats a refresh that failed exactly like a sign-out', () => {
    const seen: (AuthUser | null)[] = [];
    onAuthChange((user) => seen.push(user));

    // Supabase reports a failed refresh by emitting a null session, not by
    // throwing. If that were ignored, the app would keep drawing a signed-in
    // shell over requests that have started coming back empty.
    listeners[0]?.('TOKEN_REFRESHED', null);

    expect(seen).toEqual([null]);
  });

  it('stops listening when told to', () => {
    const stop = onAuthChange(() => {});
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
