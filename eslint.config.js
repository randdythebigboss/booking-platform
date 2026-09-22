const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  ...expoConfig,
  prettierConfig,
  {
    ignores: [
      'dist/*',
      'dist-e2e/*',
      '.expo/*',
      'node_modules/*',
      'coverage/*',
      'supabase/.temp/*',
      // Playwright's own output: traces, screenshots and the page snapshots
      // it writes next to a failure.
      'e2e/.results/*',
      'playwright-report/*',
    ],
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/supabase.admin*'],
              message:
                'The service-role client must never be imported from application code. See docs/SECURITY.md.',
            },
          ],
        },
      ],
    },
  },
  {
    // The service worker runs in a worker scope, not a browser page: its
    // globals are the standard ones and ESLint already knows them all.
    files: ['public/sw.js'],
    languageOptions: { sourceType: 'script' },
  },
  {
    files: ['tools/**/*.js', 'tools/**/*.cjs', 'tools/**/*.ts'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'writable',
        console: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      // These are command line programs. Printing to the terminal is what they
      // are for, and `console.log` is how a program does that. The rule below
      // exists to keep stray logging out of the *application*, where it would
      // ship to a device and, sooner or later, print somebody's data.
      'no-console': 'off',
    },
  },
];
