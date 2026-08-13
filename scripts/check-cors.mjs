/**
 * That the preflight names every header the client is about to send.
 *
 * This check exists because of a live failure, and because the failure looked
 * like anything but what it was. `ai-checkpoints` deployed cleanly, answered
 * `OPTIONS 200`, and then never received a single POST. The app reported
 * "Failed to send a request to the Edge Function" — which reads like a bad
 * deploy, a missing function or a network fault. It was none of those. The
 * preflight simply did not name `x-client-info`, so the browser refused to send
 * the real request and there was nothing in any log to say so.
 *
 * `x-client-info` is set unconditionally by supabase-js on every call, and no
 * application code ever mentions it — which is exactly why it was missed. So
 * this asserts the allow-list against what the installed library is actually
 * compiled to send, rather than against a list somebody typed from memory. A
 * dependency upgrade that adds a header now fails here instead of failing one
 * feature in production.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-cors-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../supabase/functions/_shared/cors.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'cors',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const { CORS, json, preflight } = await import(join(out, 'cors.js'));

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

const allowed = CORS['Access-Control-Allow-Headers']
  .split(',')
  .map((header) => header.trim().toLowerCase());

check('THE ONE THAT BROKE: x-client-info is allowed', () => {
  // supabase-js sends this on every functions.invoke. Without it here the
  // browser never sends the POST, and the function log shows only OPTIONS 200.
  assert.ok(allowed.includes('x-client-info'));
});

check('the headers supabase-js sends are all allowed', () => {
  for (const header of ['authorization', 'content-type', 'x-client-info']) {
    assert.ok(allowed.includes(header), `missing ${header}`);
  }
});

check("and the allow-list matches the installed library's own default headers", () => {
  // Read from the dependency rather than a list typed here, so an upgrade that
  // adds a header fails this test rather than one feature in production.
  const constants = readFileSync(
    new URL('../node_modules/@supabase/supabase-js/src/lib/constants.ts', import.meta.url),
    'utf8',
  );
  const block = constants.slice(constants.indexOf('export const DEFAULT_HEADERS'));
  const sent = [...block.matchAll(/'([A-Za-z-]+)':/g)].map((match) => match[1].toLowerCase());
  assert.ok(sent.length > 0, 'could not read DEFAULT_HEADERS from supabase-js');
  for (const header of sent) {
    assert.ok(allowed.includes(header), `supabase-js sends ${header}, preflight does not allow it`);
  }
});

check('POST and OPTIONS are both allowed methods', () => {
  const methods = CORS['Access-Control-Allow-Methods'].toLowerCase();
  assert.match(methods, /post/);
  assert.match(methods, /options/);
});

check('every reply carries the CORS headers, including the failures', () => {
  // A 4xx without them is a refusal the browser will not let the app read, so
  // a useful message becomes "failed to send a request".
  for (const status of [200, 400, 403, 429, 500, 503]) {
    const reply = json({ error: 'x' }, status);
    assert.equal(reply.status, status);
    assert.equal(reply.headers.get('access-control-allow-origin'), '*');
    assert.ok(reply.headers.get('access-control-allow-headers')?.includes('x-client-info'));
  }
  assert.equal(preflight().headers.get('access-control-allow-origin'), '*');
});

check('THE NEXT ONE: no browser-facing function hand-rolls its own list', () => {
  // The bug was three functions each carrying their own copy of a list that was
  // wrong in all three. A new function that does the same would reintroduce it.
  const root = new URL('../supabase/functions/', import.meta.url).pathname;
  // shared-report is reached by a plain fetch with no Authorization and no
  // client-info; its narrower list is correct for it and deliberately exempt.
  const exempt = new Set(['_shared', 'shared-report', 'deliver-webhooks', 'sweep-photos']);

  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || exempt.has(dir.name)) continue;
    const source = readFileSync(join(root, dir.name, 'index.ts'), 'utf8');
    assert.ok(
      source.includes("from '../_shared/cors.ts'"),
      `${dir.name} does not use the shared CORS reply`,
    );
    assert.ok(
      !/Access-Control-Allow-Headers/.test(source),
      `${dir.name} declares its own Access-Control-Allow-Headers`,
    );
  }
});

console.log(failures === 0 ? '\nAll CORS checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
