import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { useLocale, useRequiredWorkspace, useSession } from '@/components/providers';
import { Card, Text } from '@/components/ui';
import { WorkspaceShell } from '@/components/workspace-shell';
import { useOnline } from '@/hooks/use-online';
import { environmentName } from '@/lib/env';
import { lastErrorCode } from '@/lib/last-error';
import { releaseVersion } from '@/lib/release';
import { spacing } from '@/theme';

/**
 * What somebody helping with a problem needs to know, and nothing else.
 *
 * During a beta the useful questions are always the same: which build is this,
 * which project is it talking to, is the device online, is anybody signed in,
 * and what did the application last refuse to do. Answering them by asking a
 * tester to open a developer console does not work.
 *
 * What is deliberately absent, and must stay absent: no session token, no
 * customer name, phone or email, no booking link or guest credential, no
 * payment reference, no key of any kind. The business id is here because the
 * person reading it is a member of that business and it is the one identifier
 * that makes a support question answerable.
 *
 * The last error is a *code*, which is language-neutral and carries nothing
 * about anybody. See src/lib/last-error.ts.
 */
export default function DiagnosticsScreen() {
  const { business, professional, role } = useRequiredWorkspace();
  const session = useSession();
  const { locale } = useLocale();
  const { t } = useTranslation();
  const online = useOnline();
  const failure = lastErrorCode();

  const rows: [string, string][] = [
    [t('diagnostics.version'), releaseVersion()],
    [t('diagnostics.platform'), `${Platform.OS}${Platform.OS === 'web' ? ' (web)' : ''}`],
    [t('diagnostics.environment'), environmentName()],
    [t('diagnostics.connection'), online ? t('diagnostics.online') : t('diagnostics.offline')],
    [
      t('diagnostics.session'),
      session.status === 'signed-in' ? t('diagnostics.signedIn') : t('diagnostics.signedOut'),
    ],
    [t('diagnostics.language'), locale],
    [t('diagnostics.business'), business.id],
    [t('diagnostics.role'), role],
    [t('diagnostics.timezone'), business.timezone],
    [
      t('diagnostics.lastError'),
      failure ? `${failure.code} · ${failure.at.toISOString()}` : t('diagnostics.noErrors'),
    ],
  ];

  return (
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      narrow
      title={t('diagnostics.title')}
      subtitle={t('diagnostics.subtitle')}
    >
      <Card>
        <View style={{ gap: spacing.sm }}>
          {rows.map(([label, value]) => (
            <View key={label} style={{ gap: 2 }}>
              <Text variant="caption" tone="muted">
                {label}
              </Text>
              <Text variant="body" selectable>
                {value}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <Text variant="caption" tone="muted">
        {t('diagnostics.privacyNote')}
      </Text>
    </WorkspaceShell>
  );
}
