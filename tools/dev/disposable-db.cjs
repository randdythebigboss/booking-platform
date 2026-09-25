/**
 * Is this connection string a database we are allowed to destroy?
 *
 * ---------------------------------------------------------------------------
 * Why the existing gate was not enough
 * ---------------------------------------------------------------------------
 *
 * Both reset scripts asked the database what it was, and accepted the answer
 * `development` or `test`. The shared Supabase project answers `development`,
 * because it is one. So aiming `E2E_DB_URL` at it passed the gate, and the
 * reset would have deleted every `%@bookingplatform.test` account and reloaded
 * `supabase/seed.sql` -- which recreates the demo professional with the
 * password printed in this repository.
 *
 * That is exactly how the credential got into the cloud in the first place,
 * and asking the database to identify itself cannot catch it: a development
 * project is telling the truth.
 *
 * ---------------------------------------------------------------------------
 * What this asks instead
 * ---------------------------------------------------------------------------
 *
 * Where the database *is*. A disposable stack lives on loopback -- the
 * Supabase CLI puts it on 127.0.0.1:54322, and CI's is the same. Anything
 * reachable over the network is somebody's shared project until proven
 * otherwise, and proving otherwise is a deliberate act: `ALLOW_REMOTE_RESET`
 * has to be typed, which is the moment to read the URL again.
 *
 * Exit codes are the interface, because the callers are shell scripts:
 *   0  disposable, go ahead
 *   1  not disposable, refuse
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

/** True when the connection string names a host on this machine. */
function isLoopback(connectionString) {
  try {
    // A postgres URL is a URL, but `postgres:` is not special-cased by WHATWG,
    // so the hostname still parses correctly.
    const url = new URL(connectionString);
    return LOOPBACK.has(url.hostname);
  } catch {
    // A libpq keyword string (`host=... port=...`) rather than a URL.
    const host = /(?:^|\s)host=([^\s]+)/.exec(connectionString);
    if (host) return LOOPBACK.has(host[1]);
    // No host at all means a Unix socket or the local default.
    return !/@|host=/.test(connectionString);
  }
}

function isDisposable(connectionString, env = process.env) {
  if (env.ALLOW_REMOTE_RESET === 'yes') return true;
  return isLoopback(connectionString);
}

module.exports = { isDisposable, isLoopback };

if (require.main === module) {
  const url = process.argv[2] ?? '';
  if (isDisposable(url)) process.exit(0);

  process.stderr.write(
    'Refusing: that database is not on this machine.\n' +
      '\n' +
      'A reset deletes every fixture account and reloads supabase/seed.sql,\n' +
      'which recreates the demo professional with the password published in\n' +
      'this repository. Doing that to a shared project hands it to anybody who\n' +
      'can read GitHub.\n' +
      '\n' +
      'The database saying "development" is not enough: the shared project is\n' +
      'a development project and is telling the truth.\n' +
      '\n' +
      'If you genuinely mean a remote throwaway, set ALLOW_REMOTE_RESET=yes.\n',
  );
  process.exit(1);
}
