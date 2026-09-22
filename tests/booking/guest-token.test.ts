import { describe, expect, it } from 'vitest';

import {
  confirmationPath,
  tokenFromFragment,
  tokenFromUrl,
  upgradeLegacyTokenUrl,
} from '@/features/booking';

const TOKEN = 'afc2b268-aaef-4193-9312-ddbd663d4834';

/**
 * The token is a bearer credential. The property being tested is where it
 * rides: a fragment is never sent to a server, so it stays out of access logs,
 * `Referer` headers and anything that records page URLs.
 */

describe('confirmationPath', () => {
  it('puts the token in the fragment, never the query', () => {
    const path = confirmationPath('apt-1', TOKEN);

    expect(path).toBe(`/booking/apt-1/confirmation#token=${TOKEN}`);
    expect(path.split('#')[0]).not.toContain('token');
    expect(path).not.toContain('?');
  });

  it('escapes the token rather than trusting its shape', () => {
    expect(confirmationPath('apt-1', 'a b&c=d')).toContain('a%20b%26c%3Dd');
  });
});

describe('tokenFromFragment', () => {
  it('reads the token with or without the leading hash', () => {
    expect(tokenFromFragment(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromFragment(`token=${TOKEN}`)).toBe(TOKEN);
  });

  it('survives other fragment keys around it', () => {
    expect(tokenFromFragment(`#foo=1&token=${TOKEN}&bar=2`)).toBe(TOKEN);
  });

  it('is null when there is nothing to read', () => {
    expect(tokenFromFragment('')).toBeNull();
    expect(tokenFromFragment(null)).toBeNull();
    expect(tokenFromFragment('#')).toBeNull();
    expect(tokenFromFragment('#token=')).toBeNull();
  });
});

describe('tokenFromUrl', () => {
  it('prefers the fragment', () => {
    expect(tokenFromUrl(`https://x.test/booking/1/confirmation#token=${TOKEN}`)).toBe(TOKEN);
  });

  it('still reads a query token, because shared links have to keep working', () => {
    expect(tokenFromUrl(`https://x.test/booking/1/confirmation?token=${TOKEN}`)).toBe(TOKEN);
  });

  it('prefers the fragment when a URL somehow carries both', () => {
    expect(tokenFromUrl(`https://x.test/c?token=old#token=${TOKEN}`)).toBe(TOKEN);
  });

  it('is null for a URL with no token at all', () => {
    expect(tokenFromUrl('https://x.test/booking/1/confirmation')).toBeNull();
    expect(tokenFromUrl(null)).toBeNull();
  });

  it('reads a native deep link the same way', () => {
    expect(tokenFromUrl(`bookingplatform://booking/1/confirmation#token=${TOKEN}`)).toBe(TOKEN);
  });
});

describe('upgradeLegacyTokenUrl', () => {
  it('moves a query token into the fragment', () => {
    const upgraded = upgradeLegacyTokenUrl(`https://x.test/booking/1/confirmation?token=${TOKEN}`);

    expect(upgraded).toBe(`https://x.test/booking/1/confirmation#token=${TOKEN}`);
    expect(upgraded?.split('#')[0]).not.toContain(TOKEN);
  });

  it('leaves other query parameters where they are', () => {
    expect(upgradeLegacyTokenUrl(`https://x.test/c?lang=es&token=${TOKEN}&ref=sms`)).toBe(
      `https://x.test/c?lang=es&ref=sms#token=${TOKEN}`,
    );
  });

  it('has nothing to do when the token is already in the fragment', () => {
    expect(upgradeLegacyTokenUrl(`https://x.test/c#token=${TOKEN}`)).toBeNull();
  });

  it('has nothing to do when there is no token', () => {
    expect(upgradeLegacyTokenUrl('https://x.test/c')).toBeNull();
    expect(upgradeLegacyTokenUrl('https://x.test/c?lang=es')).toBeNull();
  });

  it('does not change the token itself', () => {
    // Entropy is the database's `gen_random_uuid()`; this only moves it.
    const upgraded = upgradeLegacyTokenUrl(`https://x.test/c?token=${TOKEN}`);
    expect(tokenFromUrl(upgraded)).toBe(TOKEN);
  });
});

describe('upgradeLegacyTokenUrl, when a URL carries the token twice', () => {
  /**
   * Seen in a real browser: the router owns the URL once it mounts, and a
   * rewrite from inside a component can end up racing it, leaving the token in
   * the query *and* the fragment. A token left in the query is the whole
   * problem, so that URL is still something to clean.
   */
  it('keeps the fragment copy and drops the query copy', () => {
    const cleaned = upgradeLegacyTokenUrl(`https://x.test/c?token=${TOKEN}#token=${TOKEN}`);

    expect(cleaned).toBe(`https://x.test/c#token=${TOKEN}`);
    expect(cleaned?.split('#')[0]).not.toContain('token');
  });

  it('keeps other fragment keys when it moves the token in', () => {
    expect(upgradeLegacyTokenUrl(`https://x.test/c?token=${TOKEN}#lang=es`)).toBe(
      `https://x.test/c#lang=es&token=${TOKEN}`,
    );
  });

  it('leaves a URL alone when the `?` is inside the fragment', () => {
    expect(upgradeLegacyTokenUrl(`https://x.test/c#token=${TOKEN}?nonsense=1`)).toBeNull();
  });
});
