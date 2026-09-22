import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { LanguageSwitcher } from '@/components/language-switcher';
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

export default function LoginScreen() {
  const { t } = useTranslation();
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
    return <Redirect href="/app/dashboard" />;
  }

  if (session.status === 'unconfigured') {
    return (
      <Screen title={t('auth.signIn')}>
        <Card>
          <Text variant="heading">{t('auth.notConfigured')}</Text>
          <Text variant="body" tone="muted">
            {t('auth.notConfiguredBody')}
          </Text>
        </Card>
      </Screen>
    );
  }

  async function submit() {
    const nextErrors: Errors = validateCredentials(email, password);
    if (mode === 'sign-up' && fullName.trim().length === 0) {
      nextErrors.fullName = issue('name.required');
    }

    setErrors(nextErrors);
    setMessage(null);
    if (hasIssues(nextErrors)) return;

    setBusy(true);
    try {
      if (mode === 'sign-in') {
        await signIn(email, password);
        // The session provider redirects as soon as Supabase reports the user.
      } else {
        const { needsConfirmation } = await signUp(email, password, fullName);
        if (needsConfirmation) {
          setMessage({ tone: 'success', text: t('auth.confirmationSent') });
          setMode('sign-in');
        }
      }
    } catch (cause) {
      setMessage({ tone: 'danger', text: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }

  const signingIn = mode === 'sign-in';

  return (
    <Screen
      title={signingIn ? t('auth.signInTitle') : t('auth.signUpTitle')}
      subtitle={signingIn ? t('auth.signInSubtitle') : t('auth.signUpSubtitle')}
    >
      <View style={{ gap: spacing.md }}>
        {!signingIn && (
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
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          error={issueText(errors.email)}
        />

        <Field
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={signingIn ? 'current-password' : 'new-password'}
          error={issueText(errors.password)}
          hint={
            signingIn
              ? undefined
              : t('validation.password.tooShort', { min: MIN_PASSWORD_LENGTH })
          }
        />

        {message && <Feedback tone={message.tone} message={message.text} />}

        <Button
          label={signingIn ? t('auth.signIn') : t('auth.signUp')}
          onPress={submit}
          loading={busy}
        />

        <Button
          variant="ghost"
          label={signingIn ? t('auth.noAccount') : t('auth.haveAccount')}
          onPress={() => {
            setMode(signingIn ? 'sign-up' : 'sign-in');
            setErrors({});
            setMessage(null);
          }}
        />
      </View>

      <Card>
        <LanguageSwitcher />
      </Card>
    </Screen>
  );
}
