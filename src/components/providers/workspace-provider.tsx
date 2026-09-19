import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

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

    if (session.status === 'signed-out' || !session.user) {
      setWorkspace(null);
      setStatus('no-session');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    fetchWorkspace(session.user.id)
      .then((result) => {
        if (cancelled) return;
        setWorkspace(result);
        setStatus(result ? 'ready' : 'no-business');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Could not load your business.');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [session.status, session.user, nonce]);

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
