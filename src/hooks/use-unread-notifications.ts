import { useWorkspace } from '@/components/providers';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { fetchUnreadNotificationCount } from '@/services/notifications';

/**
 * How many things the professional has not read yet.
 *
 * Used by the navigation, which is drawn on every workspace screen, so it has
 * to be cheap and it has to fail quietly: `count_unread_notifications` is one
 * indexed count, and if it cannot be had the badge is simply absent. A number
 * that is briefly stale costs nothing; an error banner across the sidebar
 * because a count timed out costs the whole screen.
 *
 * It uses the non-throwing `useWorkspace` rather than `useRequiredWorkspace`
 * because the navigation renders a moment before the workspace resolves.
 */
export function useUnreadNotifications(): number {
  const { workspace } = useWorkspace();
  const businessId = workspace?.business.id ?? null;

  const unread = useAsyncData(
    () => (businessId ? fetchUnreadNotificationCount(businessId) : Promise.resolve(0)),
    [businessId],
  );

  useRefreshOnFocus(unread.reload);

  return unread.data ?? 0;
}
