/**
 * Handing somebody a link, using whatever the platform already provides.
 *
 * Three ways, in order of how much they help:
 *
 *   1. the platform share sheet, where there is one -- the customer picks
 *      WhatsApp, Messages, email, whatever they already use;
 *   2. the clipboard, so the link can be pasted anywhere;
 *   3. neither, in which case the link is on screen and can be selected.
 *
 * Nothing here sends anything. No message is composed on somebody's behalf, no
 * contact is read, and no messaging provider is involved -- the share sheet
 * hands the link to an application the person chooses, and the product never
 * learns which.
 *
 * Written against injected capabilities rather than globals so the decision
 * can be tested without a browser.
 */

export interface ShareCapabilities {
  share?: (payload: { title?: string; text?: string; url: string }) => Promise<void>;
  copy?: (text: string) => Promise<void>;
}

export type ShareOutcome = 'shared' | 'copied' | 'unsupported' | 'dismissed';

/**
 * Offers the link, and reports what actually happened.
 *
 * A dismissed share sheet is not a failure and is not a fallback: somebody who
 * opened it and changed their mind does not want the link silently copied
 * instead.
 */
export async function shareOrCopy(
  url: string,
  capabilities: ShareCapabilities,
  options: { title?: string; text?: string } = {},
): Promise<ShareOutcome> {
  if (capabilities.share) {
    try {
      await capabilities.share({ url, title: options.title, text: options.text });
      return 'shared';
    } catch (cause) {
      // AbortError is the person closing the sheet. Anything else is the sheet
      // not working, and the clipboard is a reasonable second choice.
      if (isAbort(cause)) return 'dismissed';
    }
  }

  if (capabilities.copy) {
    try {
      await capabilities.copy(url);
      return 'copied';
    } catch {
      return 'unsupported';
    }
  }

  return 'unsupported';
}

function isAbort(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const name = (cause as { name?: unknown }).name;
  return name === 'AbortError' || name === 'NotAllowedError';
}

/**
 * The capabilities a web browser actually has right now.
 *
 * Both APIs exist only in a secure context and only in some browsers, and the
 * clipboard one throws rather than returning false when it is unavailable, so
 * this decides by feature rather than by user agent.
 */
export function webShareCapabilities(scope: {
  navigator?: {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    clipboard?: { writeText?: (text: string) => Promise<void> };
  };
  isSecureContext?: boolean;
}): ShareCapabilities {
  const nav = scope.navigator;
  if (!nav) return {};

  const capabilities: ShareCapabilities = {};

  if (typeof nav.share === 'function') {
    capabilities.share = (payload) => nav.share!(payload);
  }

  if (scope.isSecureContext !== false && typeof nav.clipboard?.writeText === 'function') {
    capabilities.copy = (text) => nav.clipboard!.writeText!(text);
  }

  return capabilities;
}
