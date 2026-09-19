/**
 * Environment access.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at build time, so every read has to
 * be a static property access -- a lookup by variable name would compile to
 * `undefined` on device. That is why these are spelled out one by one.
 *
 * Everything with the EXPO_PUBLIC_ prefix IS shipped to every device. Nothing
 * secret may ever be read from this module. See docs/SECURITY.md.
 */

export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
}

export class MissingEnvError extends Error {
  constructor(keys: string[]) {
    super(
      `Missing environment variables: ${keys.join(', ')}. ` +
        'Copy .env.example to .env.local and fill them in.',
    );
    this.name = 'MissingEnvError';
  }
}

function present(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

const rawSupabaseUrl = () => present(process.env.EXPO_PUBLIC_SUPABASE_URL);
const rawSupabaseAnonKey = () => present(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const rawSiteUrl = () => present(process.env.EXPO_PUBLIC_SITE_URL);

/** True when the app has enough configuration to talk to Supabase. */
export function isConfigured(): boolean {
  return Boolean(rawSupabaseUrl() && rawSupabaseAnonKey());
}

/** Throws a readable error instead of failing deep inside the Supabase client. */
export function getEnv(): AppEnv {
  const supabaseUrl = rawSupabaseUrl();
  const supabaseAnonKey = rawSupabaseAnonKey();

  const missing: string[] = [];
  if (!supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length > 0) {
    throw new MissingEnvError(missing);
  }

  return {
    supabaseUrl: supabaseUrl as string,
    supabaseAnonKey: supabaseAnonKey as string,
    siteUrl: rawSiteUrl() ?? 'http://localhost:8081',
  };
}

/** Builds the shareable public link for a business. */
export function publicBookingUrl(slug: string, siteUrl = getEnv().siteUrl): string {
  return `${siteUrl.replace(/\/+$/, '')}/p/${slug}`;
}
