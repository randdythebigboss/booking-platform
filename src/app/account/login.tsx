import { Link, Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useSession } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Text } from '@/components/ui';
import { MIN_PASSWORD_LENGTH, validateCredentials } from '@/features/auth/validation';
import { hasIssues, issue, type ValidationIssue } from '@/features/validation';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useIssueText } from '@/i18n/use-issue-text';
import { signIn, signUp } from '@/services/auth';
import { spacing } from '@/theme';

type Mode = 'sign-in' | 'sign-up';

interface Errors {
  email?: ValidationIssue;
  password?: ValidationIssue;
  fullName?: ValidationIssue;
}

/**
 * A customer's way in, which is deliberately not the professional's.
 *
 * Same Supabase Auth, different destination: this lands on the customer's own
 * appointments, while `/login` lands in a workspace and offers to create a
 * business. Sending a customer through that door would ask them to open a shop
 * in order to see a haircut appointment.
 *
 * Nothing here is required to book. The screen says so, twice, because the
 * most valuable thing about this feature is that a customer can ignore it.
 */
export default function CustomerLoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const session = useSession();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();

  const [mode, setMode] = useState<Mode>('sign-in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (session.status === 'signed-in') {
    return <Redirect href="/account" />;
  }

  async function submit() {
    const found: Errors = validateCredentials(email, password);

    if (mode === 'sign-up' && fullName.trim().length < 2) {
      found.fullName = issue('name.required');
    }

    setErrors(found);
    if (hasIssues(found)) return;

    setBusy(true);
    setMessage(null);

    try {
      if (mode === 'sign-in') {
        await signIn(email, password);
      } else {
        await signUp(email, password, fullName.trim());
      }
      router.replace('/account');
    } catch (cause) {
      setMessage({ tone: 'danger', text: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={mode === 'sign-in' ? t('account.signInTitle') : t('account.signUpTitle')}
      subtitle={mode === 'sign-in' ? t('account.signInSubtitle') : t('account.signUpSubtitle')}
    >
      <Card>
        <View style={{ gap: spacing.md }}>
          {mode === 'sign-up' && (
            <Field
              label={t('auth.fullName')}
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              autoComplete="name"
              error={issueText(errors.fullName)}
            />
          )}

          <Field
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            error={issueText(errors.email)}
          />

          <Field
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            hint={
              mode === 'sign-up'
                ? t('validation.password.tooShort', { min: MIN_PASSWORD_LENGTH })
                : undefined
            }
            error={issueText(errors.password)}
          />

          {message && <Feedback tone={message.tone} message={message.text} />}

          <Button
            label={mode === 'sign-in' ? t('auth.signIn') : t('auth.signUp')}
            onPress={submit}
            loading={busy}
          />

          <Button
            label={mode === 'sign-in' ? t('account.createOne') : t('account.haveOne')}
            variant="secondary"
            onPress={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setErrors({});
              setMessage(null);
            }}
          />
        </View>
      </Card>

      <Card>
        {/* The point worth making loudest on this screen. */}
        <Text variant="body" tone="muted">
          {t('account.guestExplainer')}
        </Text>
        <Link href="/" asChild>
          <Button label={t('account.continueAsGuest')} variant="secondary" />
        </Link>
      </Card>

      <Link href="/login" asChild>
        <Button label={t('account.forProfessionals')} variant="secondary" />
      </Link>
    </Screen>
  );
}
