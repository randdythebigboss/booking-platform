import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Asks the browser to check before throwing away unsaved work.
 *
 * Only the web has anywhere to hook this: closing a tab or hitting Back is a
 * browser action, and `beforeunload` is the one place it can be questioned.
 * On a phone the screen itself carries the warning bar instead, which is why
 * this returns quietly rather than pretending to do something on native.
 *
 * Browsers ignore the message string and show their own wording, so there is
 * nothing here to translate.
 */
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    if (typeof window === 'undefined') return;

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome still wants a truthy returnValue before it will ask.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
