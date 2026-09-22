import { useTranslation } from 'react-i18next';

import { Feedback } from '@/components/ui';
import { useOnline } from '@/hooks/use-online';

/**
 * Says, once and plainly, that what is on screen cannot be trusted.
 *
 * Availability is computed from a live calendar. Offline, the times already
 * drawn are a photograph of a minute ago, and a customer who books against
 * them is choosing a slot that may belong to somebody else. So the product
 * says so rather than letting the page look normal.
 *
 * It renders nothing at all when there is a connection, which is almost
 * always: this is not a status bar.
 */
export function OfflineNotice() {
  const online = useOnline();
  const { t } = useTranslation();

  if (online) return null;

  return <Feedback tone="danger" message={t('errors.booking.OFFLINE')} />;
}
