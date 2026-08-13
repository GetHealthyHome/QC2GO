/**
 * What a model reply has to survive before either AI feature looks at it.
 *
 * The case this file exists for is truncation. A model that runs into its
 * output limit does not return an error — it returns the answer so far, and for
 * a one-field object that is very often still valid JSON. It parses, the field
 * is there, and it is half a sentence. Nothing downstream can tell that from a
 * complete answer, so it has to be caught by the reason the model gave for
 * stopping rather than by the look of what it sent.
 *
 * None of this calls the model, and none of it loads the SDK.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-reply-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../supabase/functions/_shared/reply.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'reply',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const { interpret } = await import(join(out, 'reply.js'));

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

check('ACCEPTED: an ordinary complete answer', () => {
  const result = interpret({
    candidates: [{ finishReason: 'STOP' }],
    text: '{"note":"No condensate trap on the air handler."}',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.note, 'No condensate trap on the air handler.');
});

check('THE TRUNCATION: an answer that ran out of room is refused, not shown', () => {
  // Valid JSON, correct field, half a sentence. This is the whole point.
  const result = interpret({
    candidates: [{ finishReason: 'MAX_TOKENS' }],
    text: '{"note":"No condensate trap on the"}',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.match(result.reason, /ran longer than it was allowed/);
});

check('a blocked prompt is read before the missing text is', () => {
  const result = interpret({ promptFeedback: { blockReason: 'SAFETY' } });
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
});

check('any other reason for stopping early is a refusal too', () => {
  assert.equal(interpret({ candidates: [{ finishReason: 'SAFETY' }], text: '{"note":"x"}' }).ok, false);
  assert.equal(interpret({ candidates: [{ finishReason: 'RECITATION' }] }).ok, false);
});

check('an empty or absent body is not an answer', () => {
  assert.equal(interpret({ candidates: [{ finishReason: 'STOP' }], text: '' }).ok, false);
  assert.equal(interpret({ candidates: [{ finishReason: 'STOP' }], text: '   ' }).ok, false);
  assert.equal(interpret({ candidates: [{ finishReason: 'STOP' }] }).ok, false);
  assert.equal(interpret({}).ok, false);
});

check('a body that is not JSON is a 502, not a crash', () => {
  const result = interpret({ text: 'Here is the tidied note: no trap.' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
});

check('THE BARE VALUE: valid JSON that is not an object is refused', () => {
  // A caller would read a missing field off these and carry on as though the
  // model had said nothing, rather than as though it had answered wrongly.
  assert.equal(interpret({ text: '42' }).ok, false);
  assert.equal(interpret({ text: '"a note"' }).ok, false);
  assert.equal(interpret({ text: 'null' }).ok, false);
});

check('an array is an object, because one feature asks for a list', () => {
  const result = interpret({ text: '[{"text":"Is the trap primed?"}]' });
  assert.equal(result.ok, true);
});

console.log(failures === 0 ? '\nAll model-reply checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
