import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button, Card, Feedback, Text } from '@/components/ui';
import { spacing } from '@/theme';

export interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Absent on a section that has nothing to save, such as Payments. */
  onSave?: () => void;
  dirty?: boolean;
  busy?: boolean;
  saved?: boolean;
  error?: string | null;
}

/**
 * One group of settings, with its own Save.
 *
 * ---------------------------------------------------------------------------
 * Why the Save is not at the bottom of the page
 * ---------------------------------------------------------------------------
 *
 * Settings used to be one long column -- business details, booking rules,
 * reminders, your profile, publishing -- with a single Save under all of it.
 * Changing your phone number meant sending your booking horizon, your
 * reminder lead and your published flag along with it, and a failure anywhere
 * failed the lot. Worse, the button was a screen and a half below the field
 * being edited, so the common outcome was editing something and navigating
 * away without noticing there was anything to press.
 *
 * A section saves itself. The button is beside the fields it belongs to, it is
 * disabled until something in *this* section changes, and what it says it will
 * save is what it sends.
 */
export function SettingsSection({
  title,
  description,
  children,
  onSave,
  dirty = false,
  busy = false,
  saved = false,
  error,
}: SettingsSectionProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <Text variant="overline" tone="muted">
        {title}
      </Text>
      {description && (
        <Text variant="caption" tone="muted">
          {description}
        </Text>
      )}

      <View style={{ gap: spacing.md, marginTop: spacing.xs }}>{children}</View>

      {error && <Feedback tone="danger" message={error} />}
      {saved && !dirty && <Feedback tone="success" message={t('settings.sectionSaved')} />}

      {onSave && (
        <View style={{ flexDirection: 'row', marginTop: spacing.xs }}>
          <Button
            label={t('common.save')}
            onPress={onSave}
            loading={busy}
            disabled={!dirty}
            size="compact"
          />
        </View>
      )}
    </Card>
  );
}
