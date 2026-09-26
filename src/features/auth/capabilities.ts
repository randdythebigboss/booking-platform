import { getEnv } from '@/lib/env';

export interface AuthCapabilities {
  /**
   * Whether the Auth server will accept a new registration at all.
   *
   * The server's own answer, not a guess and not a rule the bundle carries.
   * `GET /auth/v1/settings` is public, unauthenticated and cheap, and it
   * reports `disable_signup` exactly as the project is configured.
   */
  signUpEnabled: boolean;
}

let pending: Promise<AuthCapabilities> | undefined;

/**
 * What the Auth server will actually let somebody do.
 *
 * ---------------------------------------------------------------------------
 * Why the screen asks instead of assuming
 * ---------------------------------------------------------------------------
 *
 * The sign-up forms refuse an address outside the reserved test domains. That
 * is useful guidance and it is not a boundary: it runs in a browser, and the
 * API is still the API. The boundary is the project's `disable_signup`
 * setting -- and once that is on, a form still offering to create an account
 * is advertising something that cannot happen.
 *
 * So the screens read the setting. When registration is off they say so, in
 * the reader's language, and leave sign-in and guest booking exactly as they
 * were.
 *
 * ---------------------------------------------------------------------------
 * Which way to be wrong
 * ---------------------------------------------------------------------------
 *
 * When the answer cannot be had, the form stays available. Hiding a working
 * sign-up because one request timed out has no recovery -- somebody simply
 * cannot make an account and nothing tells them why. Showing a form the
 * server then refuses does have one: `SIGNUP_DISABLED` explains it in their
 * own language. The server is the boundary in both cases.
 *
 * ---------------------------------------------------------------------------
 * Why this is not in services/auth.ts
 * ---------------------------------------------------------------------------
 *
 * It is one HTTP GET against a public endpoint and needs no Supabase client,
 * no session and no storage adapter. Keeping it out of that module keeps it
 * out of the React Native import chain, which is also what makes it testable.
 *
 * Asked once per session, because a project's Auth configuration does not
 * change while somebody is filling in a form.
 */
export async function fetchAuthCapabilities(): Promise<AuthCapabilities> {
  pending ??= (async () => {
    try {
      const env = getEnv();
      const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, {
        headers: { apikey: env.supabaseAnonKey },
      });
      if (!response.ok) return { signUpEnabled: true };

      const settings = (await response.json()) as { disable_signup?: unknown };
      // Only a literal `true` closes the form. A proxy or a future version
      // answering with a string must not silently hide a working feature.
      return { signUpEnabled: settings.disable_signup !== true };
    } catch {
      return { signUpEnabled: true };
    }
  })();

  return pending;
}

/** Test seam: forgets what the server said. */
export function resetAuthCapabilitiesCache(): void {
  pending = undefined;
}
