import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useLocale } from '@/components/providers';
import { Text } from '@/components/ui';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type Locale } from '@/locales';
import { radius, spacing, useTheme } from '@/theme';

export interface LanguageSwitcherProps {
  /** Renders the label above the choices. Off inside a card that has one. */
  showLabel?: boolean;
}

/**
 * Two words, and the one you are reading is marked.
 *
 * Each language is written in itself -- "Español", "English" -- and never as a
 * flag. A flag is a country: Spanish is not Spain to a customer in Santo
 * Domingo, and English is not the United States to one in London.
 *
 * Every option carries its own accessible label in its own language, so a
 * screen reader announces "Español" in Spanish whichever language the
 * interface is currently in. The switch applies immediately; nothing
 * remounts, so a half-filled booking form keeps what was typed.
 */
export function LanguageSwitcher({ showLabel = true }: LanguageSwitcherProps) {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();

  return (
    <View style={{ gap: spacing.sm }}>
      {showLabel && <Text variant="label">{t('language.label')}</Text>}

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('language.change')}
        style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}
      >
        {SUPPORTED_LOCALES.map((option: Locale) => {
          const chosen = option === locale;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosen, checked: chosen }}
              aria-checked={chosen}
              accessibilityLabel={LOCALE_NAMES[option]}
              onPress={() => setLocale(option)}
              style={{
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: chosen ? palette.accent : palette.border,
                backgroundColor: chosen ? palette.accent : 'transparent',
              }}
            >
              <Text variant="label" style={chosen ? { color: palette.accentText } : undefined}>
                {LOCALE_NAMES[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
