/**
 * Which webhook destinations are refused before a request is ever made.
 *
 * A webhook URL is attacker-controlled (an admin types it) and the delivery
 * function fetches it with the service_role key inside the runtime's own
 * network. The whole value of that to an attacker is reaching something that is
 * NOT on the public internet — the cloud metadata endpoint, localhost, a
 * private range — so this asserts each of those is turned away, and that
 * ordinary public destinations still get through.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-ssrf-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../supabase/functions/deliver-webhooks/ssrf.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'ssrf',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const { blockedReason } = await import(join(out, 'ssrf.js'));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

const blocked = (url) => assert.ok(blockedReason(url), `should be blocked: ${url}`);
const allowed = (url) => assert.equal(blockedReason(url), null, `should be allowed: ${url}`);

check('THE METADATA ENDPOINT: 169.254.169.254 is refused', () => {
  blocked('https://169.254.169.254/latest/meta-data/iam/security-credentials/');
  blocked('https://169.254.169.254/');
});

check('loopback in every spelling is refused', () => {
  blocked('https://127.0.0.1/');
  blocked('https://127.0.0.53:8080/x');
  blocked('https://localhost/hook');
  blocked('https://sub.localhost/hook');
  blocked('https://[::1]/');
});

check('private ranges are refused', () => {
  blocked('https://10.0.0.5/');
  blocked('https://10.255.255.255/');
  blocked('https://172.16.0.1/');
  blocked('https://172.31.255.255/');
  blocked('https://192.168.1.1/');
  blocked('https://100.64.0.1/'); // carrier-grade NAT
});

check('the unspecified and reserved addresses are refused', () => {
  blocked('https://0.0.0.0/');
  blocked('https://[::]/');
});

check('IPv6 private and link-local are refused', () => {
  blocked('https://[fc00::1]/'); // unique-local
  blocked('https://[fd12:3456::1]/');
  blocked('https://[fe80::1]/'); // link-local
  blocked('https://[::ffff:169.254.169.254]/'); // v4-mapped metadata
  blocked('https://[::ffff:127.0.0.1]/');
});

check('internal short names and suffixes are refused', () => {
  blocked('https://db/'); // no dot — an internal alias
  blocked('https://metadata.google.internal/computeMetadata/v1/');
  blocked('https://service.local/');
});

check('non-https and unparseable are refused', () => {
  blocked('http://example.com/hook'); // belt and braces with the column check
  blocked('file:///etc/passwd');
  blocked('not a url');
  blocked('https://');
});

check('172 outside the private block is still allowed', () => {
  // 172.15 and 172.32 are public — the /12 is only 16–31.
  allowed('https://172.15.0.1/hook');
  allowed('https://172.32.0.1/hook');
});

check('ordinary public destinations get through', () => {
  allowed('https://hooks.slack.com/services/T000/B000/xxxx');
  allowed('https://api.example.com/webhooks/qc2go');
  allowed('https://8.8.8.8/hook'); // a public IP literal is fine
  allowed('https://example.co.uk/');
});

console.log('');
if (failures > 0) {
  console.error(`${failures} SSRF check(s) failed.`);
  process.exit(1);
}
console.log('All webhook SSRF checks passed.');
