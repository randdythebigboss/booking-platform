import { toWorkspaceError } from '@/features/workspace';
import { getSupabase } from '@/lib/supabase';
import { isSupportedLocale, type Locale } from '@/locales';

/**
 * The signed-in user's own language preference.
 *
 * `profiles` is scoped by Row Level Security to `id = auth.uid()`, so this
 * reads and writes exactly one row -- the caller's -- and no policy had to be
 * widened to allow it.
 */
export async function fetchPreferredLocale(): Promise<Locale | null> {
  const { data, error } = await getSupabase()
    .from('profiles')
    .select('preferred_locale')
    .maybeSingle();

  if (error) throw toWorkspaceError(error);

  const value = (data as { preferred_locale?: unknown } | null)?.preferred_locale;
  return isSupportedLocale(value) ? value : null;
}

export async function savePreferredLocale(userId: string, locale: Locale): Promise<void> {
  const { error } = await getSupabase()
    .from('profiles')
    .update({ preferred_locale: locale })
    .eq('id', userId);

  if (error) throw toWorkspaceError(error);
}
