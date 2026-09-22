import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { toBookingError } from '@/features/booking';
import { toWorkspaceError } from '@/features/workspace';
import { recordErrorCode } from '@/lib/last-error';

/**
 * Turns a failure into a sentence in the current language.
 *
 * The backend never emits a localized message -- it raises `SLOT_TAKEN`, and
 * `toBookingError` / `toWorkspaceError` narrow that to a known code. This is
 * the only place the code becomes words, which is why switching language
 * re-renders an error message correctly instead of leaving the sentence it was
 * first shown in.
 *
 * An unrecognised failure lands on `UNKNOWN`, so a database message can never
 * reach a screen.
 */
export function useBookingErrorText(): (error: unknown) => string {
  const { t } = useTranslation();
  return useCallback((error: unknown) => {
    const { code } = toBookingError(error);
    // Remembered for the diagnostics panel: a code, never the words.
    recordErrorCode(code);
    return t(`errors.booking.${code}`);
  }, [t]);
}

export function useWorkspaceErrorText(): (error: unknown) => string {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
      const { code } = toWorkspaceError(error);
      recordErrorCode(code);
      return t(`errors.workspace.${code}`);
    },
    [t],
  );
}
