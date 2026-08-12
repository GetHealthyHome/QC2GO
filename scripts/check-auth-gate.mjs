// Verifies that configuring a backend actually locks the app.
//
// The sign-in gate is the only thing between the public internet and the app, so
// a regression that silently disabled it would not fail any other test — the app
// would simply work, for everyone. This builds with dummy Supabase credentials and
// asserts nothing is reachable without signing in.
//
// Usage: build with VITE_SUPABASE_* set, serve it, then run this.
import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const p = await (
  await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const fail = [];
const check = (l, c, d) => {
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${l}${c ? '' : ` (${d})`}`);
  if (!c) fail.push(l);
};

await p.goto((process.env.AUTH_URL ?? 'http://localhost:4174') + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const text = await p.locator('body').innerText();
check('sign-in screen is shown', text.includes('Sign in'), JSON.stringify(text.slice(0, 90)));
check('tagline on sign-in', text.includes('Quality in motion'));
check(
  'app content is NOT reachable',
  !text.includes('New customer') && !text.includes('Near me'),
);
check('no local-mode banner when configured', !text.includes('Local mode'));

const BASE = process.env.AUTH_URL ?? 'http://localhost:4174';

await p.goto(BASE + '/#/settings', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const deep = await p.locator('body').innerText();
check(
  'deep link to /settings is gated',
  deep.includes('Sign in') && !deep.includes('Manage checklists'),
  JSON.stringify(deep.slice(0, 90)),
);

// The roster names every account in the company and is the one screen where a
// leak would hand over a list of people rather than a single record.
await p.goto(BASE + '/#/people', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const people = await p.locator('body').innerText();
check(
  'deep link to /people is gated',
  people.includes('Sign in') && !people.includes('In the company'),
  JSON.stringify(people.slice(0, 90)),
);

await p.getByLabel('Email').fill('nobody@example.com');
await p.getByLabel('Password').fill('wrong-password');
await p.getByRole('button', { name: 'Sign in' }).click();
await p.waitForTimeout(3000);
const after = await p.locator('body').innerText();
check(
  'a failed sign-in surfaces an error rather than hanging',
  /could not reach|not recognised|error|failed/i.test(after),
  JSON.stringify(after.slice(0, 160)),
);
await p.screenshot({ path: `${process.env.SMOKE_OUT}/26-signin.png` });
check('no uncaught page errors', errs.length === 0, errs.join(' | '));

await b.close();
console.log(fail.length ? `\nAUTH GATE FAILED: ${fail.length}` : '\nAUTH GATE OK');
process.exit(fail.length ? 1 : 0);
