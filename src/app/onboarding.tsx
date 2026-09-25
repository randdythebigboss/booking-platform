import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useSession, useWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Select, Text } from '@/components/ui';
import { slugify, validateSlug } from '@/features/business/slug';
import {
  COMMON_TIMEZONES,
  detectTimezone,
  formatTimezoneLabel,
} from '@/features/business/timezones';
import { issue, type ValidationIssue } from '@/features/validation';
import { toWorkspaceError } from '@/features/workspace';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useIssueText } from '@/i18n/use-issue-text';
import { createBusiness } from '@/services/workspace';
import { spacing } from '@/theme';

export default function OnboardingScreen() {
  const session = useSession();
  const workspace = useWorkspace();
  const router = useRouter();
  const { t } = useTranslation();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();

  // A timezone name is a machine identifier, not copy: "America/Santo_Domingo"
  // reads the same in both languages and is not ours to translate.
  const timezoneOptions = COMMON_TIMEZONES.map((zone) => ({
    value: zone,
    label: formatTimezoneLabel(zone),
  }));

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
  const [errors, setErrors] = useState<{
    name?: ValidationIssue;
    slug?: ValidationIssue;
    displayName?: ValidationIssue;
  }>({});
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
    if (name.trim().length === 0) nextErrors.name = issue('business.nameRequired');
    if (displayName.trim().length === 0) {
      nextErrors.displayName = issue('displayName.required');
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
        setErrors({ slug: issue('slug.taken') });
      } else {
        setFailure(errorText(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t('onboarding.title')} subtitle={t('onboarding.whatCustomersSee')}>
      <View style={{ gap: spacing.md }}>
        <Field
          label={t('onboarding.businessName')}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholder={t('onboarding.businessNamePlaceholder')}
          error={issueText(errors.name)}
        />

        <Field
          label={t('onboarding.publicLink')}
          value={slug}
          onChangeText={(value) => {
            setSlugTouched(true);
            setSlug(value);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          prefix="/p/"
          error={issueText(errors.slug)}
          hint={t('onboarding.publicLinkPrefixHint')}
        />

        <Field
          label={t('onboarding.displayNameLabel')}
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          placeholder={t('onboarding.displayNamePlaceholder')}
          error={issueText(errors.displayName)}
          hint={t('onboarding.displayNamePicked')}
        />

        <Select
          label={t('onboarding.timezone')}
          value={timezone}
          options={timezoneOptions}
          onChange={setTimezone}
          hint={t('onboarding.timezoneShown')}
        />

        {failure && <Feedback tone="danger" message={failure} />}

        <Button label={t('onboarding.create')} onPress={submit} loading={busy} />

        <Card>
          <Text variant="caption" tone="muted">
            {t('onboarding.nothingPublicYet')}
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
