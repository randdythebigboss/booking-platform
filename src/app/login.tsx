import { Redirect } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useSession } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Text } from '@/components/ui';
import { hasErrors, validateCredentials } from '@/features/auth/validation';
import { toWorkspaceError } from '@/features/workspace';
import { signIn, signUp } from '@/services/auth';
import { spacing } from '@/theme';

type Mode = 'sign-in' | 'sign-up';

export default function LoginScreen() {
  const session = useSession();

  const [mode, setMode] = useState<Mode>('sign-in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; fullName?: string }>(
    {},
  );
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (session.status === 'signed-in') {
    return <Redirect href="/app/dashboard" />;
  }

  if (session.status === 'unconfigured') {
    return (
      <Screen title="Sign in">
        <Card>
          <Text variant="heading">Supabase is not configured</Text>
          <Text variant="body" tone="muted">
            Copy .env.example to .env.local, fill in your project URL and anon key, then restart the
            dev server.
          </Text>
        </Card>
      </Screen>
    );
  }

  async function submit() {
    const nextErrors: typeof errors = validateCredentials(email, password);
    if (mode === 'sign-up' && fullName.trim().length === 0) {
      nextErrors.fullName = 'Enter your name.';
    }

    setErrors(nextErrors);
    setMessage(null);
    if (hasErrors(nextErrors)) return;

    setBusy(true);
    try {
      if (mode === 'sign-in') {
        await signIn(email, password);
        // The session provider redirects as soon as Supabase reports the user.
      } else {
        const { needsConfirmation } = await signUp(email, password, fullName);
        if (needsConfirmation) {
          setMessage({
            tone: 'success',
            text: 'Account created. Check your email to confirm it, then sign in.',
          });
          setMode('sign-in');
        }
      }
    } catch (cause) {
      setMessage({ tone: 'danger', text: toWorkspaceError(cause).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={mode === 'sign-in' ? 'Sign in' : 'Create your account'}
      subtitle="One account manages every business you work with."
    >
      <View style={{ gap: spacing.md }}>
        {mode === 'sign-up' && (
          <Field
            label="Your name"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            autoComplete="name"
            error={errors.fullName}
          />
        )}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          error={errors.email}
        />

        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          error={errors.password}
          hint={mode === 'sign-up' ? 'At least 8 characters.' : undefined}
        />

        {message && <Feedback tone={message.tone} message={message.text} />}

        <Button
          label={mode === 'sign-in' ? 'Sign in' : 'Create account'}
          onPress={submit}
          loading={busy}
        />

        <Button
          variant="ghost"
          label={mode === 'sign-in' ? 'I do not have an account yet' : 'I already have an account'}
          onPress={() => {
            setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
            setErrors({});
            setMessage(null);
          }}
        />
      </View>
    </Screen>
  );
}
