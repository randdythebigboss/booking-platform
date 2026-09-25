import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useLocale } from '@/components/providers';
import { Text } from '@/components/ui/text';
import { LOCALE_NAMES, LOCALE_SHORT_NAMES, SUPPORTED_LOCALES, type Locale } from '@/locales';
import { TOUCH_TARGET, radius, spacing, useTheme } from '@/theme';

/**
 * The language control, small enough to live in the corner of every screen.
 *
 * It sits top-right on every page rather than at the bottom of some of them,
 * because a person who cannot read the page cannot be expected to scroll to
 * the end of it to find the way out. Being in the same place everywhere is
 * most of the value.
 *
 * Two letters, not a flag. A flag is a country, and Spanish is not Spain to
 * somebody in Santo Domingo. The full name is still what a screen reader
 * announces, in its own language, whichever language the interface is in.
 *
 * Switching is a state change and nothing else: no remount, no navigation, no
 * refetch. A half-filled booking form keeps what was typed, the chosen date
 * stays chosen, and nobody is signed out.
 */
export function LanguageToggle() {
  const { palette } = useTheme();
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('language.change')}
      style={{
        flexDirection: 'row',
        alignSelf: 'flex-start',
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.border,
        overflow: 'hidden',
      }}
    >
      {SUPPORTED_LOCALES.map((option: Locale) => {
        const chosen = option === locale;

        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: chosen, checked: chosen }}
            aria-checked={chosen}
            // The full name, in its own language, so a screen reader says
            // "Español" rather than "E S".
            accessibilityLabel={LOCALE_NAMES[option]}
            onPress={() => setLocale(option)}
            style={{
              // Never smaller than a thumb, in either direction.
              minWidth: 44,
              minHeight: TOUCH_TARGET,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: spacing.sm,
              backgroundColor: chosen ? palette.accent : 'transparent',
            }}
          >
            <Text
              variant="caption"
              style={{
                fontWeight: '600',
                color: chosen ? palette.accentText : palette.textMuted,
              }}
            >
              {LOCALE_SHORT_NAMES[option]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
