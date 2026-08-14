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
// The tagline is drawn into the lockup rather than set as text beneath it, so
// it is the image's accessible name that has to carry it — which is the thing
// worth asserting anyway. A logo whose alt text is "logo" passes an eyeball
// test and tells somebody using a screen reader nothing.
check(
  'the lockup names the company, tagline and all',
  (await p.getByRole('img', { name: /QC2GO — Quality in motion/ }).count()) > 0,
);
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

// Endpoints carry signing secrets, which are credentials.
await p.goto(BASE + '/#/integrations', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const integrations = await p.locator('body').innerText();
check(
  'deep link to /integrations is gated',
  integrations.includes('Sign in') && !integrations.includes('Signing secret'),
  JSON.stringify(integrations.slice(0, 90)),
);

/*
 * The shared-report route is the one exemption from the sign-in gate, so it is
 * the one worth testing hardest. Three things have to be true: an invented token
 * discloses nothing, the screen says so rather than failing blankly, and the
 * exemption does not extend one character further than the route it was written
 * for.
 *
 * Note what this arrives from: the gated /integrations screen, above. Moving
 * between two hashes of the same document is not a page load, so this only
 * works if the app re-reads the route when it changes rather than when it
 * mounts. It did not, once — a recipient with the app already open in that tab
 * got the sign-in screen and no way past it.
 */
const SHARE_URL =
  BASE + '/#/shared/0000000000000000000000000000000000000000000000000000000000000000';

await p.goto(SHARE_URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const shared = await p.locator('body').innerText();
check(
  'an invented share token discloses nothing',
  !shared.includes('New customer') && !shared.includes('Signing secret') && !/Sign in/.test(shared),
  JSON.stringify(shared.slice(0, 120)),
);
check(
  'and says so rather than failing blankly',
  /cannot be opened|not valid|could not/i.test(shared),
  JSON.stringify(shared.slice(0, 120)),
);

// And again as a cold open, which is how a recipient actually arrives.
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const cold = await p.locator('body').innerText();
check(
  'a share link opened cold behaves the same way',
  !/Sign in/.test(cold) && /cannot be opened|not valid|could not/i.test(cold),
  JSON.stringify(cold.slice(0, 120)),
);

// A path that merely starts the same way must not inherit the exemption.
await p.goto(BASE + '/#/shared', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const bare = await p.locator('body').innerText();
check('the exemption does not extend past its own route', bare.includes('Sign in'), JSON.stringify(bare.slice(0, 90)));

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
