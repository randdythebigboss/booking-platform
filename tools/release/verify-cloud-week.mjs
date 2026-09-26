/**
 * Does the deployed beta use the cloud weekly RPC, or is it quietly falling
 * back?
 *
 *   node tools/release/verify-cloud-week.mjs
 *   SITE=... node tools/release/verify-cloud-week.mjs
 *   node tools/release/verify-cloud-week.mjs --api-only
 *
 * `--api-only` skips the browser half, for checking a stack that has no
 * deployed page in front of it. SUPABASE_URL and SUPABASE_ANON_KEY override
 * what .env.local says, so this can be pointed at any stack.
 *
 * ---------------------------------------------------------------------------
 * Why "it works" is not the question
 * ---------------------------------------------------------------------------
 *
 * `fetchWeekAvailability` degrades on purpose: a database without
 * `get_week_availability` gets the same answer computed one day at a time.
 * That is the right behaviour and it is also invisible -- the strip looks
 * identical either way, so a screenshot proves nothing about which path ran.
 *
 * So this watches the network. One `rpc/get_week_availability` returning 200
 * and no `rpc/get_day_schedule` storm means the function is being used. A 404
 * followed by seven day calls means it is not, however good the page looks.
 *
 * It reads only public endpoints with the anon key. No credential is needed
 * and none is printed.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SITE = process.env.SITE ?? 'https://randdythebigboss.github.io/booking-platform';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const URL_ = process.env.SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const API_ONLY = process.argv.includes('--api-only');
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

const checks = [];
const check = (label, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const rpc = async (name, body) => {
  const response = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

// --------------------------------------------------------------- the API
const business = await fetch(
  `${URL_}/rest/v1/businesses?select=id,slug&is_published=eq.true&limit=1`,
  { headers: HEADERS },
).then((r) => r.json());
const slug = business?.[0]?.slug;
if (!slug) {
  console.log('FAIL  no published business to test against');
  process.exit(1);
}

const pros = await fetch(
  `${URL_}/rest/v1/professional_profiles?select=id&business_id=eq.${business[0].id}&is_bookable=eq.true&limit=1`,
  { headers: HEADERS },
).then((r) => r.json());
const services = await fetch(
  `${URL_}/rest/v1/services?select=id,name,duration_minutes&business_id=eq.${business[0].id}&is_active=eq.true&order=duration_minutes.asc`,
  { headers: HEADERS },
).then((r) => r.json());

const professionalId = pros?.[0]?.id;
const shortest = services?.[0];
const longest = services?.[services.length - 1];

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santo_Domingo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const week = await rpc('get_week_availability', {
  p_professional_id: professionalId,
  p_service_id: shortest?.id,
  p_from: today,
  p_days: 7,
});

check('the cloud has get_week_availability', week.status === 200, `HTTP ${week.status}`);
if (week.status !== 200) {
  console.log('\nThe migration has not been applied. See docs/OPERATIONS.md.');
  process.exit(1);
}

check(
  'it answers for seven days',
  Array.isArray(week.body) && week.body.length === 7,
  `${week.body?.length} rows`,
);

const shape = [...new Set((week.body ?? []).flatMap((row) => Object.keys(row)))].sort().join(',');
check('it returns only a date, a state and a free count', shape === 'day,free_count,state', shape);

const states = [...new Set((week.body ?? []).map((row) => row.state))];
check(
  'every state is one of the five',
  states.every((s) => ['open', 'full', 'closed', 'past', 'beyond'].includes(s)),
  states.join(','),
);

// Availability is service-dependent, and the UI must never flatten that.
if (longest && longest.id !== shortest.id) {
  const wide = await rpc('get_week_availability', {
    p_professional_id: professionalId,
    p_service_id: longest.id,
    p_from: today,
    p_days: 7,
  });
  const sum = (rows) => (rows ?? []).reduce((total, row) => total + row.free_count, 0);
  check(
    'a longer service never shows more availability than a shorter one',
    sum(wide.body) <= sum(week.body),
    `${longest.duration_minutes}min=${sum(wide.body)} <= ${shortest.duration_minutes}min=${sum(week.body)}`,
  );
}

// The range is bounded, so this cannot walk somebody's calendar a year at a time.
const tooWide = await rpc('get_week_availability', {
  p_professional_id: professionalId,
  p_service_id: shortest?.id,
  p_from: today,
  p_days: 400,
});
check('an over-wide range is refused', tooWide.status >= 400, `HTTP ${tooWide.status}`);

// A professional who is not bookable must return nothing, not an error.
const hidden = await rpc('get_week_availability', {
  p_professional_id: '00000000-0000-4000-8000-000000000000',
  p_service_id: shortest?.id,
  p_from: today,
  p_days: 7,
});
check(
  'an unknown professional returns nothing rather than an error',
  hidden.status === 200 && Array.isArray(hidden.body) && hidden.body.length === 0,
  `HTTP ${hidden.status}, ${hidden.body?.length} rows`,
);

// ------------------------------------------------------- the deployed page
if (API_ONLY) {
  const passedApi = checks.filter(Boolean).length;
  console.log(`
${passedApi}/${checks.length} API checks passed (browser half skipped)`);
  process.exit(passedApi === checks.length ? 0 : 1);
}

const browser = await chromium.launch();
const page = await browser
  .newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'es-DO',
    timezoneId: 'America/Santo_Domingo',
  })
  .then((c) => c.newPage());
page.setDefaultNavigationTimeout(90000);

const calls = [];
page.on('response', (response) => {
  const url = response.url();
  if (url.includes('/rpc/get_week_availability'))
    calls.push({ kind: 'week', status: response.status() });
  if (url.includes('/rpc/get_day_schedule')) calls.push({ kind: 'day', status: response.status() });
});

await page.goto(`${SITE}/p/${slug}/book`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.getByRole('radio', { name: new RegExp(shortest.name) }).click();
await page.waitForTimeout(6000);

const weekCalls = calls.filter((c) => c.kind === 'week');
const dayCalls = calls.filter((c) => c.kind === 'day');

check(
  'the deployed page calls the weekly RPC',
  weekCalls.length > 0,
  `${weekCalls.length} call(s)`,
);
check(
  'and the cloud answers it',
  weekCalls.every((c) => c.status === 200),
  weekCalls.map((c) => c.status).join(','),
);
// The fallback fans out one call per day. One or two day calls is the chosen
// day's own slot list, which is a different thing.
check(
  'it is not falling back to a day-by-day fan-out',
  dayCalls.length <= 2,
  `${dayCalls.length} day call(s)`,
);

const chips = await page
  .getByRole('radio', { name: /— (\d+ horas? libres?|Cerrado|Sin horas)/ })
  .count();
check('the strip renders from that answer', chips >= 5, `${chips} chips`);

await browser.close();

const passed = checks.filter(Boolean).length;
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
