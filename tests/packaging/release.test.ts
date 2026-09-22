import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * The version contract.
 *
 * Before this existed, `package.json` said `0.1.0` and `app.json` said
 * `1.0.0`, and the diagnostics screen -- reading the second one -- reported a
 * 1.0.0 release of a product that had never been released. Nothing failed,
 * because nothing was checking.
 */

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const appConfig = JSON.parse(readFileSync('app.json', 'utf8')).expo;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

describe('the release version', () => {
  it('is a semantic version with a prerelease tag while this is a beta', () => {
    const match = SEMVER.exec(packageJson.version);
    expect(match, `${packageJson.version} is not a semantic version`).not.toBeNull();
    expect(match?.[4], 'a release candidate carries a prerelease tag').toBeTruthy();
  });

  it('is the same string in package.json and in the application config', () => {
    expect(appConfig.extra?.release).toBe(packageJson.version);
  });

  /**
   * Apple and Google both parse `expo.version`, and neither accepts a
   * prerelease tag. Keeping the platform version to its numeric core is what
   * lets the product call itself `-beta.1` without breaking a future build.
   */
  it('keeps a plain numeric version for the platforms that demand one', () => {
    const [core] = packageJson.version.split('-');
    expect(appConfig.version).toBe(core);
    expect(appConfig.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is written down where the release checklist can be checked against it', () => {
    const release = readFileSync('docs/RELEASE.md', 'utf8');
    expect(release).toContain(packageJson.version);
  });
});
