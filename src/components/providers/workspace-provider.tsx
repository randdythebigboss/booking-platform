import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { fetchWorkspace, type Workspace } from '@/services/workspace';
import { useSession } from './session-provider';

export type WorkspaceStatus =
  'loading' | 'unconfigured' | 'no-session' | 'no-business' | 'ready' | 'error';

export interface WorkspaceValue {
  status: WorkspaceStatus;
  workspace: Workspace | null;
  /**
   * The failure itself, not a sentence taken out of it.
   *
   * A backend message is a code in one fixed language; turning it into words
   * is the job of `useWorkspaceErrorText`, in the language the screen is
   * being read in. Storing the message here once put the raw code "UNKNOWN" in
   * front of a professional.
   */
  error: unknown;
  /** Re-reads the business after it changes, so every screen stays in step. */
  refresh: () => void;
}

const WorkspaceContext = createContext<WorkspaceValue>({
  status: 'loading',
  workspace: null,
  error: null,
  refresh: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<WorkspaceStatus>('loading');
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  // Read inside the effect without making the effect depend on it.
  const workspaceRef = useRef<Workspace | null>(null);
  workspaceRef.current = workspace;

  // The id, not the user object: onAuthChange builds a fresh { id, email } for
  // every auth event, including the token refresh the SDK performs when a
  // backgrounded tab becomes visible again. Depending on the object would
  // re-run the effect below on each of them.
  const userId = session.user?.id ?? null;

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (session.status === 'unconfigured') {
      setStatus('unconfigured');
      return;
    }

    if (session.status === 'loading') {
      setStatus('loading');
      return;
    }

    if (session.status === 'signed-out' || !userId) {
      setWorkspace(null);
      setStatus('no-session');
      return;
    }

    let cancelled = false;
    // Only announce loading when there is nothing to show. A refresh that
    // replaces a workspace we already have must not blank the tree: the guard
    // above renders a spinner instead of the navigator, and unmounting the
    // navigator throws the professional off whatever screen they were on.
    setStatus((current) => (workspaceRef.current ? current : 'loading'));
    setError(null);

    fetchWorkspace(userId)
      .then((result) => {
        if (cancelled) return;
        setWorkspace(result);
        setStatus(result ? 'ready' : 'no-business');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause);
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [session.status, userId, nonce]);

  const value = useMemo<WorkspaceValue>(
    () => ({ status, workspace, error, refresh }),
    [status, workspace, error, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  return useContext(WorkspaceContext);
}

/**
 * For screens behind the workspace guard, where a business is guaranteed.
 * Throws rather than returning null so a mistake shows up immediately.
 */
export function useRequiredWorkspace(): Workspace {
  const { workspace } = useWorkspace();
  if (!workspace) {
    throw new Error('useRequiredWorkspace was called outside the workspace guard.');
  }
  return workspace;
}
