import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The cleanup tool's address pattern.
 *
 * ---------------------------------------------------------------------------
 * Why this is read out of the file rather than imported
 * ---------------------------------------------------------------------------
 *
 * `tools/dev/cleanup-probe-accounts.mjs` is one script with top-level `await`:
 * importing it would talk to a project and refuse for want of a service-role
 * key. The pattern is the part that decides what gets deleted, so it is worth
 * a test on its own, and lifting the literal out of the source is the cheapest
 * honest way to get one.
 *
 * ---------------------------------------------------------------------------
 * What went wrong once
 * ---------------------------------------------------------------------------
 *
 * The pattern required a numeric suffix. Most probe accounts are named after a
 * timestamp, so that looked right -- but `gate-reusable@bookingplatform.test`
 * exists, and the tool reported it as "not a probe address" and left it on the
 * project. A cleanup tool that silently skips is worse than none, because the
 * report reads as an all-clear.
 */
describe('the probe-account pattern', () => {
  const source = readFileSync('tools/dev/cleanup-probe-accounts.mjs', 'utf8');
  const match = source.match(/^const PROBE = (\/.+\/[a-z]*);$/m);
  if (!match?.[1]) throw new Error('the PROBE literal is no longer where this test looks for it');

  const body = match[1].slice(1, match[1].lastIndexOf('/'));
  const flags = match[1].slice(match[1].lastIndexOf('/') + 1);
  const PROBE = new RegExp(body, flags);

  it.each([
    'probe-1790379260310@bookingplatform.test',
    'p14-probe-1790369339471@bookingplatform.test',
    'gate-1790396027984@bookingplatform.test',
    'gate-reusable@bookingplatform.test',
    'GATE-Reusable@BookingPlatform.test',
  ])('matches %s', (email) => {
    expect(PROBE.test(email)).toBe(true);
  });

  it.each([
    // The demonstration account. Also refused by name, deliberately twice.
    'demo@bookingplatform.test',
    // A professional's account on the same reserved domain.
    'alex@bookingplatform.test',
    // The prefix alone is not a probe address.
    'gate@bookingplatform.test',
    // The right shape on the wrong domain is somebody's real address.
    'gate-1790396027984@example.com',
    'probe-1@gmail.com',
  ])('leaves %s alone', (email) => {
    expect(PROBE.test(email)).toBe(false);
  });

  it('is anchored at both ends', () => {
    expect(body.startsWith('^')).toBe(true);
    expect(body.endsWith('$')).toBe(true);
  });

  it('still refuses the demonstration account by name as well', () => {
    expect(source).toContain("NEVER = new Set(['demo@bookingplatform.test'])");
  });

  it('still proves an account owns nothing before removing it', () => {
    for (const table of ['businesses', 'professional_profiles', 'customers']) {
      expect(source).toContain(`owns('${table}'`);
    }
  });

  it('still refuses a project that does not say it is development', () => {
    expect(source).toMatch(/environment !== 'development'/);
  });

  it('still does nothing without --delete', () => {
    expect(source).toContain("const DELETE = process.argv.includes('--delete')");
  });
});
