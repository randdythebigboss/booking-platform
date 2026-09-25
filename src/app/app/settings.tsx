import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AzulPlaceholder } from '@/components/azul-placeholder';
import { useRequiredWorkspace, useWorkspace } from '@/components/providers';
import { SettingsSection } from '@/components/settings-section';
import {
  Button,
  Card,
  Feedback,
  Dropdown,
  Field,
  SearchableSelect,
  Text,
  ToggleRow,
} from '@/components/ui';
import { WorkspaceShell } from '@/components/workspace-shell';
import { validateSlug } from '@/features/business/slug';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/features/business/timezones';
import { parseNumericInput } from '@/features/services/validation';
import { issue, type ValidationIssue } from '@/features/validation';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
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

type Section = 'business' | 'profile' | 'rules' | 'reminders' | 'publication';

/**
 * How long before an appointment its reminder goes out.
 *
 * Off, or one of four lead times. Not a free number: a reminder is a promise
 * to a customer, and four answers cover every shop anybody has described.
 */
const REMINDER_CHOICES = [0, 60, 120, 1440, 2880] as const;

/**
 * Everything about a business that is not its calendar.
 *
 * ---------------------------------------------------------------------------
 * Five sections, five Save buttons
 * ---------------------------------------------------------------------------
 *
 * This was one column of eighteen controls with a single Save at the bottom.
 * Changing a phone number sent the booking horizon, the reminder lead and the
 * published flag with it, and the button was a screen and a half below the
 * field being edited. Each section now saves itself, and only itself.
 *
 * ---------------------------------------------------------------------------
 * Published and accepting bookings are different things
 * ---------------------------------------------------------------------------
 *
 * They lived in different halves of the old page and read almost identically,
 * so nobody could say what the pair of them meant together. They are now side
 * by side under Publication, with a sentence above them that states the actual
 * consequence of the combination -- including the quiet one, where the page is
 * published, the link works, and there is not a single time to book because
 * the only professional has stopped accepting.
 */
export default function SettingsScreen() {
  const { business, professional } = useRequiredWorkspace();
  const workspace = useWorkspace();
  const { t } = useTranslation();
  const issueText = useIssueText();
  const errorText = useWorkspaceErrorText();

  // Timezone names are machine identifiers, not copy.
  const timezoneOptions = COMMON_TIMEZONES.map((zone) => ({
    value: zone as string,
    label: formatTimezoneLabel(zone),
  }));

  const [name, setName] = useState(business.name);
  const [slug, setSlug] = useState(business.slug);
  const [description, setDescription] = useState(business.description ?? '');
  const [phone, setPhone] = useState(business.phone ?? '');
  const [email, setEmail] = useState(business.email ?? '');
  const [address, setAddress] = useState(business.address ?? '');
  const [timezone, setTimezone] = useState<string>(business.timezone);

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
  const [busy, setBusy] = useState<Section | null>(null);
  const [saved, setSaved] = useState<Section | null>(null);
  const [failure, setFailure] = useState<{ section: Section; message: string } | null>(null);

  const dirty: Record<Section, boolean> = {
    business:
      name !== business.name ||
      slug !== business.slug ||
      description !== (business.description ?? '') ||
      phone !== (business.phone ?? '') ||
      email !== (business.email ?? '') ||
      address !== (business.address ?? '') ||
      timezone !== business.timezone,
    profile: displayName !== (professional?.displayName ?? '') || bio !== (professional?.bio ?? ''),
    rules:
      slotInterval !== String(business.slotIntervalMinutes) ||
      minimumNotice !== String(business.minimumNoticeMinutes) ||
      horizon !== String(business.bookingHorizonDays) ||
      autoConfirm !== business.autoConfirmBookings,
    reminders: reminderLead !== String(business.reminderLeadMinutes),
    publication:
      isPublished !== business.isPublished || isBookable !== (professional?.isBookable ?? true),
  };

  useUnsavedChanges(Object.values(dirty).some(Boolean));

  /** Runs one section's save, and owns the busy, saved and error states. */
  async function run(section: Section, checks: Errors, work: () => Promise<void>) {
    setErrors(checks);
    setFailure(null);
    setSaved(null);
    if (Object.values(checks).some(Boolean)) return;

    setBusy(section);
    try {
      await work();
      setSaved(section);
      workspace.refresh();
    } catch (cause) {
      setFailure({ section, message: errorText(cause) });
    } finally {
      setBusy(null);
    }
  }

  function saveBusiness() {
    const checks: Errors = {};
    if (name.trim().length === 0) checks.name = issue('business.nameRequired');
    const slugError = validateSlug(slug);
    if (slugError) checks.slug = slugError;

    return run('business', checks, () =>
      updateBusiness(business.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        timezone,
      }),
    );
  }

  function saveProfile() {
    const checks: Errors = {};
    if (professional && displayName.trim().length === 0) {
      checks.displayName = issue('displayName.required');
    }

    return run('profile', checks, async () => {
      if (!professional) return;
      await updateProfessional(professional.id, {
        displayName: displayName.trim(),
        bio: bio.trim() || null,
      });
    });
  }

  function saveRules() {
    const checks: Errors = {};
    const parsedInterval = parseNumericInput(slotInterval);
    const parsedNotice = parseNumericInput(minimumNotice);
    const parsedHorizon = parseNumericInput(horizon);

    if (!Number.isInteger(parsedInterval) || parsedInterval < 1) {
      checks.slotInterval = issue('policy.slotInterval');
    }
    if (!Number.isInteger(parsedNotice) || parsedNotice < 0) {
      checks.minimumNotice = issue('policy.minimumNotice');
    }
    if (!Number.isInteger(parsedHorizon) || parsedHorizon < 0 || parsedHorizon > 365) {
      checks.horizon = issue('policy.horizon');
    }

    return run('rules', checks, () =>
      updateBusiness(business.id, {
        slotIntervalMinutes: parsedInterval,
        minimumNoticeMinutes: parsedNotice,
        bookingHorizonDays: parsedHorizon,
        autoConfirmBookings: autoConfirm,
      }),
    );
  }

  function saveReminders() {
    return run('reminders', {}, () =>
      updateBusiness(business.id, { reminderLeadMinutes: Number(reminderLead) }),
    );
  }

  function savePublication() {
    return run('publication', {}, async () => {
      await updateBusiness(business.id, { isPublished });
      if (professional) await updateProfessional(professional.id, { isBookable });
    });
  }

  const sectionError = (section: Section) =>
    failure?.section === section ? failure.message : null;

  // What the two switches add up to, said once, in the order that matters.
  const publicationStatus = !isPublished
    ? t('settings.statusUnpublished')
    : professional && !isBookable
      ? t('settings.statusNotAccepting')
      : t('settings.statusLive');

  return (
    <WorkspaceShell
      businessName={business.name}
      professionalName={professional?.displayName ?? undefined}
      title={t('settings.title')}
      subtitle={t('settings.subtitle')}
      narrow
    >
      <SettingsSection
        title={t('settings.businessSection')}
        description={t('settings.businessSectionHint')}
        onSave={saveBusiness}
        dirty={dirty.business}
        busy={busy === 'business'}
        saved={saved === 'business'}
        error={sectionError('business')}
      >
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

        {/* The warning is worth more when it is about to happen than when it
            is a standing footnote, so it only appears once the box differs
            from what is published. */}
        {slug !== business.slug && slug.trim().length > 0 && (
          <Feedback
            tone="warning"
            message={t('settings.slugChanging', { from: business.slug, to: slug.trim() })}
          />
        )}

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
          inputMode="tel"
        />
        <Field
          label={t('settings.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          inputMode="email"
        />
        <Field label={t('settings.address')} value={address} onChangeText={setAddress} multiline />

        <SearchableSelect
          label={t('settings.timezone')}
          value={timezone}
          options={timezoneOptions}
          onChange={setTimezone}
          searchLabel={t('settings.searchTimezone')}
          emptyLabel={t('settings.noTimezoneMatch')}
          hint={t('settings.timezoneKeepsMoment')}
        />
      </SettingsSection>

      {professional && (
        <SettingsSection
          title={t('settings.profileSection')}
          description={t('settings.profileSectionHint')}
          onSave={saveProfile}
          dirty={dirty.profile}
          busy={busy === 'profile'}
          saved={saved === 'profile'}
          error={sectionError('profile')}
        >
          <Field
            label={t('settings.nameCustomersSee')}
            value={displayName}
            onChangeText={setDisplayName}
            error={issueText(errors.displayName)}
          />
          <Field label={t('settings.shortBio')} value={bio} onChangeText={setBio} multiline />
        </SettingsSection>
      )}

      <SettingsSection
        title={t('settings.rulesSection')}
        description={t('settings.rulesSectionHint')}
        onSave={saveRules}
        dirty={dirty.rules}
        busy={busy === 'rules'}
        saved={saved === 'rules'}
        error={sectionError('rules')}
      >
        <Field
          label={t('settings.slotIntervalLabel')}
          value={slotInterval}
          onChangeText={setSlotInterval}
          keyboardType="number-pad"
          inputMode="numeric"
          error={issueText(errors.slotInterval)}
          hint={t('settings.slotIntervalHint')}
        />
        <Field
          label={t('settings.minimumNoticeLabel')}
          value={minimumNotice}
          onChangeText={setMinimumNotice}
          keyboardType="number-pad"
          inputMode="numeric"
          error={issueText(errors.minimumNotice)}
          hint={t('settings.minimumNoticeHint')}
        />
        <Field
          label={t('settings.bookingHorizonLabel')}
          value={horizon}
          onChangeText={setHorizon}
          keyboardType="number-pad"
          inputMode="numeric"
          error={issueText(errors.horizon)}
          hint={t('settings.bookingHorizonHint')}
        />

        <ToggleRow
          label={t('settings.autoConfirm')}
          description={t('settings.autoConfirmOff')}
          value={autoConfirm}
          onChange={setAutoConfirm}
        />
      </SettingsSection>

      <SettingsSection
        title={t('settings.remindersSection')}
        onSave={saveReminders}
        dirty={dirty.reminders}
        busy={busy === 'reminders'}
        saved={saved === 'reminders'}
        error={sectionError('reminders')}
      >
        {/* A short list rather than a number field: "how long before" is a
            choice between a handful of sensible answers, and a box that accepts
            37 minutes invites somebody to type 37 minutes. */}
        <Dropdown
          label={t('settings.reminderLeadLabel')}
          value={reminderLead}
          options={REMINDER_CHOICES.map((minutes) => ({
            value: String(minutes),
            label: t(`settings.reminderLead_${minutes}` as never),
          }))}
          onChange={setReminderLead}
          hint={t('settings.reminderLeadHint')}
        />

        {/* Said here rather than only in a document. A professional choosing
            "24 hours before" is entitled to know nothing will arrive. */}
        <Feedback tone="muted" message={t('settings.remindersNotDelivered')} />
        <View style={{ flexDirection: 'row' }}>
          <Link href="/app/notifications" asChild>
            <Button label={t('settings.seeNotifications')} variant="secondary" size="compact" />
          </Link>
        </View>
      </SettingsSection>

      <SettingsSection title={t('settings.paymentsSection')}>
        <AzulPlaceholder />
      </SettingsSection>

      <SettingsSection
        title={t('settings.publicationSection')}
        description={publicationStatus}
        onSave={savePublication}
        dirty={dirty.publication}
        busy={busy === 'publication'}
        saved={saved === 'publication'}
        error={sectionError('publication')}
      >
        <Text variant="body" tone="muted" selectable>
          {publicBookingUrl(business.slug)}
        </Text>

        <ToggleRow
          label={t('settings.publishedLabel')}
          description={t('settings.publishedHidden')}
          value={isPublished}
          onChange={setIsPublished}
        />

        {professional && (
          <ToggleRow
            label={t('settings.acceptingBookings')}
            description={t('settings.acceptingBookingsHint')}
            value={isBookable}
            onChange={setIsBookable}
          />
        )}
      </SettingsSection>

      <Card>
        <Text variant="caption" tone="muted">
          {t('language.hint')}
        </Text>
        <Text variant="caption" tone="muted">
          {t('settings.diagnosticsHint')}
        </Text>
        <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
          {/* Technical details for a support conversation. No customer data. */}
          <Link href="/app/diagnostics" asChild>
            <Button label={t('diagnostics.title')} variant="ghost" size="compact" />
          </Link>
        </View>
      </Card>
    </WorkspaceShell>
  );
}
