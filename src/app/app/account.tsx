import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useRequiredWorkspace, useSession } from '@/components/providers';
import { Button, Card, Text } from '@/components/ui';
import { WorkspaceShell } from '@/components/workspace-shell';
import { signOut } from '@/services/auth';
import { spacing } from '@/theme';

/**
 * Who is signed in, and how to stop being.
 *
 * Sign-out used to be a button at the bottom of the dashboard, below the
 * navigation stack, which put the one irreversible action on the screen
 * somebody opens every morning. It belongs behind the account control in the
 * header, where it is found on purpose rather than by accident.
 */
export default function WorkspaceAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useSession();
  const { business, professional } = useRequiredWorkspace();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      title={t('account.title')}
      narrow
    >
      <Card>
        <View style={{ gap: spacing.xs }}>
          <Text variant="overline" tone="muted">
            {t('nav.workspace')}
          </Text>
          <Text variant="heading">{business.name}</Text>
          {professional?.displayName && (
            <Text variant="body" tone="muted">
              {professional.displayName}
            </Text>
          )}
          {session.user?.email && (
            <Text variant="caption" tone="muted">
              {t('account.signedInAs', { email: session.user.email })}
            </Text>
          )}
        </View>
      </Card>

      <Card>
        <Text variant="heading">{t('settings.title')}</Text>
        <Text variant="body" tone="muted">
          {t('settings.subtitle')}
        </Text>
        <Link href="/app/settings" asChild>
          <Button label={t('nav.settings')} variant="secondary" />
        </Link>
      </Card>

      <Button
        label={t('auth.signOut')}
        variant="danger"
        loading={signingOut}
        onPress={async () => {
          setSigningOut(true);
          try {
            await signOut();
            router.replace('/');
          } finally {
            setSigningOut(false);
          }
        }}
      />
    </WorkspaceShell>
  );
}
