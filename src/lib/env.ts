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

/**
 * The shape a Supabase URL has.
 *
 * Checked because the failure it prevents is the expensive one: a URL that is
 * merely *wrong* connects successfully to somebody else's project and the app
 * looks like it works. A typo in a project reference is silent; a missing
 * scheme is silent; "https://supabase.com/dashboard/..." pasted from a browser
 * is silent. None of them are silent any more.
 */
const SUPABASE_URL_SHAPE = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/;

/** Both key formats Supabase issues. Neither is a secret; see docs/SECURITY.md. */
const PUBLISHABLE_KEY_SHAPE =
  /^(sb_publishable_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})$/;

export class MissingEnvError extends Error {
  constructor(keys: string[]) {
    super(
      `Missing environment variables: ${keys.join(', ')}. ` +
        'Copy .env.example to .env.local and fill them in.',
    );
    this.name = 'MissingEnvError';
  }
}

/**
 * Configuration that is present but wrong.
 *
 * Deliberately separate from `MissingEnvError`: "you forgot to set it" and
 * "you set it to something that cannot be right" need different answers, and
 * the second one is the one that otherwise ships.
 */
export class InvalidEnvError extends Error {
  readonly key: string;

  constructor(key: string, reason: string) {
    // The key's name, never its value: this message reaches logs and screens.
    super(`${key} is not valid: ${reason}.`);
    this.name = 'InvalidEnvError';
    this.key = key;
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

  if (!SUPABASE_URL_SHAPE.test(supabaseUrl as string)) {
    throw new InvalidEnvError(
      'EXPO_PUBLIC_SUPABASE_URL',
      'it should look like https://<project>.supabase.co',
    );
  }

  if (!PUBLISHABLE_KEY_SHAPE.test(supabaseAnonKey as string)) {
    throw new InvalidEnvError(
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'it should be the project publishable key',
    );
  }

  return {
    supabaseUrl: supabaseUrl as string,
    supabaseAnonKey: supabaseAnonKey as string,
    siteUrl: rawSiteUrl() ?? 'http://localhost:8081',
  };
}

/**
 * Which project this build talks to, as a name a person can compare.
 *
 * The project reference out of the URL, and nothing else. Safe to show in a
 * diagnostics panel: it is already in every request the app makes, and seeing
 * it is how somebody notices the app is pointed at the wrong environment.
 */
export function environmentName(): string {
  const url = rawSupabaseUrl();
  if (!url) return 'unconfigured';

  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\./);
  if (!match) return 'unknown';
  if (url.includes('127.0.0.1') || url.includes('localhost')) return 'local';
  return match[1] ?? 'unknown';
}

/** True when the configuration is present and the right shape. */
export function isValidConfiguration(): boolean {
  try {
    getEnv();
    return true;
  } catch {
    return false;
  }
}

/** Builds the shareable public link for a business. */
export function publicBookingUrl(slug: string, siteUrl = getEnv().siteUrl): string {
  return `${siteUrl.replace(/\/+$/, '')}/p/${slug}`;
}
