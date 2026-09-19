import { useState } from 'react';
import { View } from 'react-native';

import { useRequiredWorkspace, useWorkspace } from '@/components/providers';
import { Button, Card, Feedback, Field, Screen, Select, Text, ToggleRow } from '@/components/ui';
import { validateSlug } from '@/features/business/slug';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/features/business/timezones';
import { parseNumericInput } from '@/features/services/validation';
import { toWorkspaceError } from '@/features/workspace';
import { publicBookingUrl } from '@/lib/env';
import { updateBusiness, updateProfessional } from '@/services/workspace';
import { spacing } from '@/theme';

const TIMEZONE_OPTIONS = COMMON_TIMEZONES.map((zone) => ({
  value: zone,
  label: formatTimezoneLabel(zone),
}));

interface Errors {
  name?: string;
  slug?: string;
  slotInterval?: string;
  minimumNotice?: string;
  horizon?: string;
  displayName?: string;
}

export default function SettingsScreen() {
  const { business, professional } = useRequiredWorkspace();
  const workspace = useWorkspace();

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

    if (name.trim().length === 0) next.name = 'Give your business a name.';

    const slugError = validateSlug(slug);
    if (slugError) next.slug = slugError;

    if (!Number.isInteger(values.slotInterval) || (values.slotInterval as number) < 1) {
      next.slotInterval = 'Use a whole number of minutes, at least 1.';
    }
    if (!Number.isInteger(values.minimumNotice) || (values.minimumNotice as number) < 0) {
      next.minimumNotice = 'Use a whole number of minutes, zero or more.';
    }
    if (
      !Number.isInteger(values.horizon) ||
      (values.horizon as number) < 0 ||
      (values.horizon as number) > 365
    ) {
      next.horizon = 'Use a whole number of days, between 0 and 365.';
    }
    if (professional && displayName.trim().length === 0) {
      next.displayName = 'Enter the name customers will see.';
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
      setFailure(toWorkspaceError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Settings" subtitle="Your business, your link, and the rules bookings follow.">
      <View style={{ gap: spacing.md }}>
        <Text variant="heading">Business</Text>

        <Field label="Name" value={name} onChangeText={setName} error={errors.name} />

        <Field
          label="Public link"
          value={slug}
          onChangeText={setSlug}
          autoCapitalize="none"
          autoCorrect={false}
          prefix="/p/"
          error={errors.slug}
          hint="Changing this breaks any link you have already shared."
        />

        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder="What you do, in a sentence."
        />

        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Field label="Address" value={address} onChangeText={setAddress} multiline />

        <Select
          label="Timezone"
          value={timezone}
          options={TIMEZONE_OPTIONS}
          onChange={setTimezone}
          hint="Existing appointments keep the exact moment they were booked for."
        />

        <Text variant="heading">Booking rules</Text>

        <Field
          label="Slot interval, in minutes"
          value={slotInterval}
          onChangeText={setSlotInterval}
          keyboardType="number-pad"
          error={errors.slotInterval}
          hint="How far apart the offered start times are."
        />
        <Field
          label="Minimum notice, in minutes"
          value={minimumNotice}
          onChangeText={setMinimumNotice}
          keyboardType="number-pad"
          error={errors.minimumNotice}
          hint="How far ahead of now the earliest bookable time is."
        />
        <Field
          label="Booking horizon, in days"
          value={horizon}
          onChangeText={setHorizon}
          keyboardType="number-pad"
          error={errors.horizon}
          hint="How far into the future customers may book."
        />

        <ToggleRow
          label="Confirm bookings automatically"
          description="Turn this off to review each booking before it is confirmed."
          value={autoConfirm}
          onChange={setAutoConfirm}
        />

        {professional && (
          <>
            <Text variant="heading">Your professional profile</Text>
            <Field
              label="Name customers see"
              value={displayName}
              onChangeText={setDisplayName}
              error={errors.displayName}
            />
            <Field label="Short bio" value={bio} onChangeText={setBio} multiline />
            <ToggleRow
              label="Accepting bookings"
              description="Turn this off to stop new bookings without unpublishing the page."
              value={isBookable}
              onChange={setIsBookable}
            />
          </>
        )}

        <Card>
          <Text variant="heading">Publishing</Text>
          <Text variant="body" tone="muted" selectable>
            {publicBookingUrl(business.slug)}
          </Text>
          <ToggleRow
            label="Published"
            description="While this is off, the page is invisible and nobody can book."
            value={isPublished}
            onChange={setIsPublished}
          />
        </Card>

        {failure && <Feedback tone="danger" message={failure} />}
        {saved && <Feedback tone="success" message="Your settings are saved." />}

        <Button label="Save settings" onPress={submit} loading={busy} />
      </View>
    </Screen>
  );
}
