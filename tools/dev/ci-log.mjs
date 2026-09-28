/**
 * Prints the tail of a failed CI job's log.
 *
 *   node tools/dev/ci-log.mjs [jobNameFragment] [lines]
 *
 * The run summary says which step failed; it does not say why. Fetching the
 * log is the difference between guessing at a Playwright failure and reading
 * the assertion. Same credential handling as the other two: git's own helper,
 * never printed.
 */
import { execFileSync } from 'node:child_process';

const wanted = (process.argv[2] ?? 'End-to-end').toLowerCase();
const tail = Number(process.argv[3] ?? 120);

const remote = execFileSync('git', ['config', '--get', 'remote.origin.url']).toString().trim();
const [, owner, repo] = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(remote) ?? [];
const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
const head = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();

const credentials = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
}).toString();
const auth = Buffer.from(
  `${/^username=(.*)$/m.exec(credentials)?.[1] ?? ''}:${/^password=(.*)$/m.exec(credentials)?.[1] ?? ''}`,
).toString('base64');

const headers = {
  Authorization: `Basic ${auth}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'booking-platform-ci-log',
};

const runs = await fetch(
  `https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${branch}&per_page=5`,
  { headers },
).then((r) => r.json());
const run = runs.workflow_runs.find((candidate) => candidate.head_sha === head);
if (!run) {
  console.error('no run for HEAD');
  process.exit(2);
}

const { jobs } = await fetch(
  `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/jobs`,
  { headers },
).then((r) => r.json());
const job = jobs.find((candidate) => candidate.name.toLowerCase().includes(wanted));
if (!job) {
  console.error(`no job matching "${wanted}"`);
  process.exit(2);
}

const log = await fetch(
  `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`,
  { headers },
).then((r) => r.text());

const lines = log.split('\n');
console.log(lines.slice(-tail).join('\n'));
