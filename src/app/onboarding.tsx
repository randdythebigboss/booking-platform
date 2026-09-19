import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useSession, useWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Select, Text } from '@/components/ui';
import { slugify, validateSlug } from '@/features/business/slug';
import {
  COMMON_TIMEZONES,
  detectTimezone,
  formatTimezoneLabel,
} from '@/features/business/timezones';
import { toWorkspaceError } from '@/features/workspace';
import { createBusiness } from '@/services/workspace';
import { spacing } from '@/theme';

const TIMEZONE_OPTIONS = COMMON_TIMEZONES.map((zone) => ({
  value: zone,
  label: formatTimezoneLabel(zone),
}));

export default function OnboardingScreen() {
  const session = useSession();
  const workspace = useWorkspace();
  const router = useRouter();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState(() => {
    const detected = detectTimezone();
    return (COMMON_TIMEZONES as readonly string[]).includes(detected)
      ? detected
      : 'America/Santo_Domingo';
  });
  const [errors, setErrors] = useState<{ name?: string; slug?: string; displayName?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The public link follows the business name until it is edited by hand.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  if (session.status === 'signed-out') return <Redirect href="/login" />;
  if (workspace.status === 'ready') return <Redirect href="/app/dashboard" />;

  async function submit() {
    const nextErrors: typeof errors = {};
    if (name.trim().length === 0) nextErrors.name = 'Give your business a name.';
    if (displayName.trim().length === 0) {
      nextErrors.displayName = 'Enter the name customers will see.';
    }
    const slugError = validateSlug(slug);
    if (slugError) nextErrors.slug = slugError;

    setErrors(nextErrors);
    setFailure(null);
    if (Object.values(nextErrors).some(Boolean)) return;

    setBusy(true);
    try {
      await createBusiness({ name, slug, timezone, displayName });
      workspace.refresh();
      router.replace('/app/dashboard');
    } catch (cause) {
      const error = toWorkspaceError(cause);
      if (error.code === 'SLUG_TAKEN') {
        setErrors({ slug: error.message });
      } else {
        setFailure(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Set up your business"
      subtitle="This is what customers see when you share your link."
    >
      <View style={{ gap: spacing.md }}>
        <Field
          label="Business name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholder="Demo Studio"
          error={errors.name}
        />

        <Field
          label="Public link"
          value={slug}
          onChangeText={(value) => {
            setSlugTouched(true);
            setSlug(value);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          prefix="/p/"
          error={errors.slug}
          hint="Lowercase letters, numbers and dashes. You can change it later."
        />

        <Field
          label="Your name as a professional"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          placeholder="Alex Rivera"
          error={errors.displayName}
          hint="Customers pick this person when they book."
        />

        <Select
          label="Timezone"
          value={timezone}
          options={TIMEZONE_OPTIONS}
          onChange={setTimezone}
          hint="Every appointment time is shown in this zone."
        />

        {failure && <Feedback tone="danger" message={failure} />}

        <Button label="Create business" onPress={submit} loading={busy} />

        <Card>
          <Text variant="caption" tone="muted">
            Nothing is public yet. Your page goes live only when you publish it from Settings.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
