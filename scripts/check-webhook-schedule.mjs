/**
 * When a failed webhook is retried, and when it is given up on.
 *
 * This is the kind of logic whose bugs are invisible until they are expensive:
 * a backoff that does not back off hammers a customer's server, and one that
 * gives up too early loses an event somebody was relying on. Neither shows up
 * in a screenshot, and both are cheap to assert.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-webhook-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../supabase/functions/deliver-webhooks/schedule.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'schedule',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const s = await import(join(out, 'schedule.js'));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.message.split('\n')[0]}`);
  }
}

const NOW = new Date('2026-08-12T12:00:00.000Z');
const secondsAfter = (date) => (date.getTime() - NOW.getTime()) / 1000;

check('any 2xx counts as delivered', () => {
  // Receivers answer 201, 202 and 204 all the time. Treating those as failures
  // would re-send an event somebody has already acted on.
  for (const status of [200, 201, 202, 204, 299]) {
    assert.equal(s.isDelivered(status), true, `${status} was not accepted`);
  }
  for (const status of [301, 400, 404, 500, 503]) {
    assert.equal(s.isDelivered(status), false, `${status} was accepted`);
  }
});

check('a refusal is not retried for two hours', () => {
  // 4xx means the receiver understood and said no — a wrong URL, a revoked
  // token. Retrying that is noise on somebody else's server.
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(s.isWorthRetrying(status), false, `${status} would be retried`);
  }
});

check('"not now" is different from "no"', () => {
  // The two 4xx codes that explicitly mean try again.
  assert.equal(s.isWorthRetrying(408), true, 'a timeout should be retried');
  assert.equal(s.isWorthRetrying(429), true, 'a rate limit should be retried');
});

check('a server error or a dropped connection is retried', () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(s.isWorthRetrying(status), true, `${status} would not be retried`);
  }
  // Zero is the code used when the request never got a response at all.
  assert.equal(s.isWorthRetrying(0), true);
});

check('the backoff actually backs off', () => {
  let previous = 0;
  for (let attempt = 1; attempt < s.MAX_ATTEMPTS; attempt += 1) {
    const at = s.nextAttemptAfter(attempt, NOW);
    assert.ok(at, `attempt ${attempt} gave up early`);
    const wait = secondsAfter(at);
    assert.ok(wait > previous, `attempt ${attempt} waited ${wait}s, no longer than ${previous}s`);
    previous = wait;
  }
});

check('the first retry is soon and the last is not', () => {
  // Most failures are a deploy or a blip and are over in seconds; anything
  // still failing after an hour will not be fixed by asking again in thirty.
  assert.ok(secondsAfter(s.nextAttemptAfter(1, NOW)) <= 60, 'the first retry is too far away');
  assert.ok(
    secondsAfter(s.nextAttemptAfter(s.MAX_ATTEMPTS - 1, NOW)) >= 1800,
    'the last retry comes back too quickly',
  );
});

check('it gives up rather than retrying forever', () => {
  assert.equal(s.nextAttemptAfter(s.MAX_ATTEMPTS, NOW), null);
  assert.equal(s.nextAttemptAfter(s.MAX_ATTEMPTS + 10, NOW), null);
});

check('the whole run of attempts spans hours, not minutes', () => {
  // A queue that exhausts itself in ninety seconds has not survived anything.
  let total = 0;
  for (let attempt = 1; attempt < s.MAX_ATTEMPTS; attempt += 1) {
    total += secondsAfter(s.nextAttemptAfter(attempt, NOW));
  }
  assert.ok(total >= 3600, `every attempt would be spent within ${Math.round(total / 60)} minutes`);
});

console.log(failures === 0 ? '\nAll webhook schedule checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
