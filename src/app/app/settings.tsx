import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { LanguageSwitcher } from '@/components/language-switcher';
import { useRequiredWorkspace, useWorkspace } from '@/components/providers';
import { Link } from 'expo-router';

import { Button, Card, Feedback, Field, Screen, Select, Text, ToggleRow } from '@/components/ui';
import { validateSlug } from '@/features/business/slug';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/features/business/timezones';
import { parseNumericInput } from '@/features/services/validation';
import { issue, type ValidationIssue } from '@/features/validation';
import { useWorkspaceErrorText } from '@/i18n/use-error-text';
import { useIssueText } from '@/i18n/use-issue-text';
import { publicBookingUrl } from '@/lib/env';
import { updateBusiness, updateProfessional } from '@/services/workspace';
import { spacing } from '@/theme';

interface Errors {
  name?: ValidationIssue;
  slug?: ValidationIssue;
  slotInterval?: ValidationIssue;
  minimumNotice?: ValidationIssue;
  horizon?: ValidationIssue;
  displayName?: ValidationIssue;
}

/**
 * How long before an appointment its reminder goes out.
 *
 * Off, or one of four lead times. Not a free number: a reminder is a promise
 * to a customer, and four answers cover every shop anybody has described.
 */
const REMINDER_CHOICES = [0, 60, 120, 1440, 2880] as const;

export default function SettingsScreen() {
  const { business, professional } = useRequiredWorkspace();
  const workspace = useWorkspace();
  const { t } = useTranslation();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();

  // Timezone names are machine identifiers, not copy.
  const timezoneOptions = COMMON_TIMEZONES.map((zone) => ({
    value: zone,
    label: formatTimezoneLabel(zone),
  }));

  const [name, setName] = useState(business.name);
  const [slug, setSlug] = useState(business.slug);
  const [description, setDescription] = useState(business.description ?? '');
  const [phone, setPhone] = useState(business.phone ?? '');
  const [email, setEmail] = useState(business.email ?? '');
  const [address, setAddress] = useState(business.address ?? '');
  const [timezone, setTimezone] = useState(business.timezone);

  const [slotInterval, setSlotInterval] = useState(String(business.slotIntervalMinutes));
  const [minimumNotice, setMinimumNotice] = useState(String(business.minimumNoticeMinutes));
  const [horizon, setHorizon] = useState(String(business.bookingHorizonDays));
  const [autoConfirm, setAutoConfirm] = useState(business.autoConfirmBookings);
  const [reminderLead, setReminderLead] = useState(String(business.reminderLeadMinutes));
  const [isPublished, setIsPublished] = useState(business.isPublished);

  const [displayName, setDisplayName] = useState(professional?.displayName ?? '');
  const [bio, setBio] = useState(professional?.bio ?? '');
  const [isBookable, setIsBookable] = useState(professional?.isBookable ?? true);

  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function validate(): { errors: Errors; values: Record<string, number> } {
    const next: Errors = {};
    const values: Record<string, number> = {
      slotInterval: parseNumericInput(slotInterval),
      minimumNotice: parseNumericInput(minimumNotice),
      horizon: parseNumericInput(horizon),
    };

    if (name.trim().length === 0) next.name = issue('business.nameRequired');

    const slugError = validateSlug(slug);
    if (slugError) next.slug = slugError;

    if (!Number.isInteger(values.slotInterval) || (values.slotInterval as number) < 1) {
      next.slotInterval = issue('policy.slotInterval');
    }
    if (!Number.isInteger(values.minimumNotice) || (values.minimumNotice as number) < 0) {
      next.minimumNotice = issue('policy.minimumNotice');
    }
    if (
      !Number.isInteger(values.horizon) ||
      (values.horizon as number) < 0 ||
      (values.horizon as number) > 365
    ) {
      next.horizon = issue('policy.horizon');
    }
    if (professional && displayName.trim().length === 0) {
      next.displayName = issue('displayName.required');
    }

    return { errors: next, values };
  }

  async function submit() {
    const { errors: nextErrors, values } = validate();
    setErrors(nextErrors);
    setFailure(null);
    setSaved(false);
    if (Object.values(nextErrors).some(Boolean)) return;

    setBusy(true);
    try {
      await updateBusiness(business.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        timezone,
        slotIntervalMinutes: values.slotInterval as number,
        minimumNoticeMinutes: values.minimumNotice as number,
        bookingHorizonDays: values.horizon as number,
        autoConfirmBookings: autoConfirm,
        reminderLeadMinutes: Number(reminderLead),
        isPublished,
      });

      if (professional) {
        await updateProfessional(professional.id, {
          displayName: displayName.trim(),
          bio: bio.trim() || null,
          isBookable,
        });
      }

      setSaved(true);
      workspace.refresh();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={t('settings.title')} subtitle={t('settings.subtitle')}>
      <View style={{ gap: spacing.md }}>
        <Text variant="heading">{t('settings.business')}</Text>

        <Field
          label={t('settings.businessName')}
          value={name}
          onChangeText={setName}
          error={issueText(errors.name)}
        />

        <Field
          label={t('settings.publicLink')}
          value={slug}
          onChangeText={setSlug}
          autoCapitalize="none"
          autoCorrect={false}
          prefix="/p/"
          error={issueText(errors.slug)}
          hint={t('settings.slugWarning')}
        />

        <Field
          label={t('settings.description')}
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder={t('settings.descriptionPlaceholder')}
        />

        <Field
          label={t('settings.phone')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <Field
          label={t('settings.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Field
          label={t('settings.address')}
          value={address}
          onChangeText={setAddress}
          multiline
        />

        <Select
          label={t('settings.timezone')}
          value={timezone}
          options={timezoneOptions}
          onChange={setTimezone}
          hint={t('settings.timezoneKeepsMoment')}
        />

        <Text variant="heading">{t('settings.policy')}</Text>

        <Field
          label={t('settings.slotIntervalLabel')}
          value={slotInterval}
          onChangeText={setSlotInterval}
          keyboardType="number-pad"
          error={issueText(errors.slotInterval)}
          hint={t('settings.slotIntervalHint')}
        />
        <Field
          label={t('settings.minimumNoticeLabel')}
          value={minimumNotice}
          onChangeText={setMinimumNotice}
          keyboardType="number-pad"
          error={issueText(errors.minimumNotice)}
          hint={t('settings.minimumNoticeHint')}
        />
        <Field
          label={t('settings.bookingHorizonLabel')}
          value={horizon}
          onChangeText={setHorizon}
          keyboardType="number-pad"
          error={issueText(errors.horizon)}
          hint={t('settings.bookingHorizonHint')}
        />

        <ToggleRow
          label={t('settings.autoConfirm')}
          description={t('settings.autoConfirmOff')}
          value={autoConfirm}
          onChange={setAutoConfirm}
        />

        {/* A short list rather than a number field: "how long before" is a
            choice between a handful of sensible answers, and a box that accepts
            37 minutes invites somebody to type 37 minutes. */}
        <Select
          label={t('settings.reminderLeadLabel')}
          value={reminderLead}
          options={REMINDER_CHOICES.map((minutes) => ({
            value: String(minutes),
            label: t(`settings.reminderLead_${minutes}` as never),
          }))}
          onChange={setReminderLead}
          hint={t('settings.reminderLeadHint')}
        />

        {professional && (
          <>
            <Text variant="heading">{t('settings.yourProfile')}</Text>
            <Field
              label={t('settings.nameCustomersSee')}
              value={displayName}
              onChangeText={setDisplayName}
              error={issueText(errors.displayName)}
            />
            <Field
              label={t('settings.shortBio')}
              value={bio}
              onChangeText={setBio}
              multiline
            />
            <ToggleRow
              label={t('settings.acceptingBookings')}
              description={t('settings.acceptingBookingsHint')}
              value={isBookable}
              onChange={setIsBookable}
            />
          </>
        )}

        <Card>
          <Text variant="heading">{t('settings.publishing')}</Text>
          <Text variant="body" tone="muted" selectable>
            {publicBookingUrl(business.slug)}
          </Text>
          <ToggleRow
            label={t('settings.published')}
            description={t('settings.publishedHidden')}
            value={isPublished}
            onChange={setIsPublished}
          />
        </Card>

        {failure && <Feedback tone="danger" message={failure} />}
        {saved && <Feedback tone="success" message={t('settings.saved')} />}

        <Button label={t('settings.save')} onPress={submit} loading={busy} />

        {/* Technical details for a support conversation. No customer data. */}
        <Link href="/app/diagnostics" asChild>
          <Button label={t('diagnostics.title')} variant="ghost" />
        </Link>

        <Card>
          <LanguageSwitcher />
          <Text variant="caption" tone="muted">
            {t('language.hint')}
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
