import { describe, expect, it, vi } from 'vitest';

import { shareOrCopy, webShareCapabilities } from '@/features/sharing';

/**
 * Handing somebody a link. The product never sends anything itself, so the
 * only decisions here are which affordance to offer and what to do when the
 * person walks away from it.
 */

const LINK = 'https://example.test/p/salon-aurora';

describe('shareOrCopy', () => {
  it('uses the platform share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);

    await expect(shareOrCopy(LINK, { share }, { title: 'Salón Aurora' })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ url: LINK, title: 'Salón Aurora', text: undefined });
  });

  it('falls back to the clipboard when there is no share sheet', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);

    await expect(shareOrCopy(LINK, { copy })).resolves.toBe('copied');
    expect(copy).toHaveBeenCalledWith(LINK);
  });

  it('does not quietly copy when somebody closed the share sheet', async () => {
    // Changing your mind is not a failure, and reacting to it by copying
    // anyway is the product deciding it knows better.
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' });
    const share = vi.fn().mockRejectedValue(abort);
    const copy = vi.fn();

    await expect(shareOrCopy(LINK, { share, copy })).resolves.toBe('dismissed');
    expect(copy).not.toHaveBeenCalled();
  });

  it('falls back when the share sheet is broken rather than dismissed', async () => {
    const share = vi.fn().mockRejectedValue(new Error('no handler'));
    const copy = vi.fn().mockResolvedValue(undefined);

    await expect(shareOrCopy(LINK, { share, copy })).resolves.toBe('copied');
  });

  it('says so when the platform can do neither', async () => {
    await expect(shareOrCopy(LINK, {})).resolves.toBe('unsupported');
  });
});

describe('webShareCapabilities', () => {
  it('finds both when the browser has both', () => {
    const capabilities = webShareCapabilities({
      navigator: { share: async () => {}, clipboard: { writeText: async () => {} } },
      isSecureContext: true,
    });

    expect(capabilities.share).toBeTypeOf('function');
    expect(capabilities.copy).toBeTypeOf('function');
  });

  it('will not use the clipboard outside a secure context', () => {
    // It would throw rather than return false, which is a crash in a place
    // nobody expects one.
    const capabilities = webShareCapabilities({
      navigator: { clipboard: { writeText: async () => {} } },
      isSecureContext: false,
    });

    expect(capabilities.copy).toBeUndefined();
  });

  it('finds nothing where there is no navigator at all', () => {
    expect(webShareCapabilities({})).toEqual({});
  });
});
