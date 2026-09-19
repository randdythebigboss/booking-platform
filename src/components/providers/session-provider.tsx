import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { isConfigured } from '@/lib/env';
import { getCurrentUser, onAuthChange, type AuthUser } from '@/services/auth';

export type SessionStatus = 'loading' | 'unconfigured' | 'signed-out' | 'signed-in';

export interface SessionValue {
  status: SessionStatus;
  user: AuthUser | null;
}

const SessionContext = createContext<SessionValue>({ status: 'loading', user: null });

/**
 * Holds the Supabase session for the whole app.
 *
 * `unconfigured` is a first-class state: a fresh clone with no .env.local
 * should explain itself rather than crash on the first auth call.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SessionValue>(() =>
    isConfigured() ? { status: 'loading', user: null } : { status: 'unconfigured', user: null },
  );

  useEffect(() => {
    if (!isConfigured()) return;

    let cancelled = false;

    getCurrentUser()
      .then((user) => {
        if (cancelled) return;
        setValue({ status: user ? 'signed-in' : 'signed-out', user });
      })
      .catch(() => {
        if (cancelled) return;
        setValue({ status: 'signed-out', user: null });
      });

    const unsubscribe = onAuthChange((user) => {
      if (cancelled) return;
      setValue({ status: user ? 'signed-in' : 'signed-out', user });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const memoised = useMemo(() => value, [value]);

  return <SessionContext.Provider value={memoised}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
