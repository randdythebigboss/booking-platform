/**
 * Build-time additions to app.json.
 *
 * app.json stays the source of truth for everything static -- the name, the
 * icons, the identifiers, the release string -- and the packaging tests read
 * it directly. This file exists for the one thing that cannot be static: where
 * the application is served from.
 *
 * ---------------------------------------------------------------------------
 * APP_BASE_PATH
 * ---------------------------------------------------------------------------
 *
 * Empty for a site at a domain root, which is the normal case and the default.
 *
 * A GitHub Pages *project* site serves from `https://<user>.github.io/<repo>/`,
 * and every absolute path the build emits has to carry that prefix or 404.
 * Expo rewrites its own paths from `experiments.baseUrl`; the hand-written ones
 * in src/app/+html.tsx read `process.env.EXPO_BASE_URL`, which Expo sets from
 * the same value. See docs/DEPLOYMENT.md.
 *
 * It is set by the deployment workflow and by nothing else, so a local build
 * and a local test are unaffected.
 *
 * ---------------------------------------------------------------------------
 * EXPO_PUBLIC_ALLOW_INDEXING
 * ---------------------------------------------------------------------------
 *
 * Read in src/app/+html.tsx. Absent means the build asks search engines to
 * stay away, which is the right default while the only deployment is a beta
 * full of invented people. Opting in is deliberate and has to be typed.
 */
module.exports = ({ config }) => {
  const basePath = (process.env.APP_BASE_PATH ?? '').replace(/\/+$/, '');

  if (basePath && !basePath.startsWith('/')) {
    throw new Error(`APP_BASE_PATH must start with "/", got "${basePath}"`);
  }

  return {
    ...config,
    experiments: { ...config.experiments, baseUrl: basePath },
  };
};
