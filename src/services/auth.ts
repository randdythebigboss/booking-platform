import { toWorkspaceError } from '@/features/workspace';
import { getSupabase } from '@/lib/supabase';

export interface AuthUser {
  id: string;
  email: string | null;
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) throw toWorkspaceError(error);
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Creates the account. Whether a session comes back immediately depends on
 * the project's email-confirmation setting, so the caller has to handle both.
 */
export async function signUp(
  email: string,
  password: string,
  fullName: string,
): Promise<{ user: AuthUser | null; needsConfirmation: boolean }> {
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: fullName.trim() } },
  });

  if (error) throw toWorkspaceError(error);

  return {
    user: data.user ? { id: data.user.id, email: data.user.email ?? null } : null,
    needsConfirmation: data.session === null,
  };
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw toWorkspaceError(error);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw toWorkspaceError(error);

  const user = data.session?.user;
  return user ? { id: user.id, email: user.email ?? null } : null;
}

/**
 * Tells the caller who is signed in, and only when that changes.
 *
 * Supabase emits an auth event for more than sign-in and sign-out: it refreshes
 * the token on a timer, and again when a backgrounded tab becomes visible. Each
 * one would otherwise hand out a freshly allocated user object for the same
 * person, and anything watching that object by identity -- a React effect, a
 * memo -- would treat it as a new user and start over.
 *
 * So the same id is reported once. Callers see a change only when there is one.
 *
 * Returns an unsubscribe function.
 */
export function onAuthChange(listener: (user: AuthUser | null) => void): () => void {
  let lastId: string | null | undefined;

  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    const id = user ? user.id : null;

    if (id === lastId) return;
    lastId = id;

    listener(user ? { id: user.id, email: user.email ?? null } : null);
  });

  return () => data.subscription.unsubscribe();
}

