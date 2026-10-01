/**
 * Load test: schedules N emails for (almost) the same moment and reports.
 *
 *   npm run load-test -- --count 1000 --hourly 200
 *
 * Needs ALLOW_DEV_LOGIN=true (local only) so it can log in without a browser.
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);

const API = args.api ?? process.env.API_URL ?? 'http://localhost:4000';
const COUNT = Number(args.count ?? 1000);
const HOURLY = Number(args.hourly ?? 200);
const DELAY = Number(args.delay ?? 0);
const START_IN = Number(args.startIn ?? 5);

async function main() {
  const login = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'loadtest@example.dev', name: 'Load Test' }),
  });
  if (!login.ok) throw new Error(`dev-login failed (${login.status}). Set ALLOW_DEV_LOGIN=true for local testing.`);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];

  const leads = Array.from({ length: COUNT }, (_, i) => `load${i}.${Date.now()}@example.com`);
  const t0 = Date.now();
  const res = await fetch(`${API}/api/campaigns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      subject: `Load test ×${COUNT}`,
      body: 'Load test email',
      leads,
      startAt: new Date(Date.now() + START_IN * 1000).toISOString(),
      delayMs: DELAY,
      hourlyLimit: HOURLY,
    }),
  });
  const data = await res.json();
  console.log(`scheduled ${data.scheduled} emails in ${Date.now() - t0} ms`);
  console.log(`planned first send ${data.firstSendAt}, last ${data.lastSendAt}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
