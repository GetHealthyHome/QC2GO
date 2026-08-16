// Functional test of the org-handover guard: drives configureSync against real
// IndexedDB in a real browser, importing the actual modules through the vite
// dev server's transform. Spawns its own dev server so it is self-contained.
// Usage: node scripts/check-org-guard.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
// Without this the child handle keeps the event loop alive and the script
// never exits, which reads as a hang in CI.
server.unref();
function stopServer() {
  try {
    process.kill(-server.pid);
  } catch {
    // Already gone.
  }
}
process.on('exit', stopServer);
// Wait for the server to answer.
for (let attempt = 0; ; attempt += 1) {
  try {
    await fetch(BASE);
    break;
  } catch {
    if (attempt > 60) throw new Error('vite dev server never came up');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

const results = await page.evaluate(async () => {
  const sync = await import('/src/lib/sync.ts');
  const db = await import('/src/lib/db.ts');
  const out = [];
  const check = (name, ok, detail = '') => out.push({ name, ok, detail });

  // Start clean.
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('qc2go');
    req.onsuccess = req.onerror = req.onblocked = resolve;
  });

  // 1. First connect stamps the device with org A and does not block.
  await sync.configureSync({ userId: 'user-1', isAdmin: true, orgId: 'org-A' });
  let status = sync.getSyncStatus();
  check('first connect not blocked', status.phase !== 'blocked', status.phase);
  let account = await db.syncAccountRepo.get();
  check('device stamped org-A', account?.orgId === 'org-A', JSON.stringify(account));

  // 2. Give the device data belonging to org A.
  await db.customersRepo.put({ id: 'c1', name: 'Acme Job', updatedAt: new Date().toISOString() });

  // 3. Same org, different colleague: carries on, re-stamped, not blocked.
  await sync.configureSync({ userId: 'user-2', isAdmin: false, orgId: 'org-A' });
  status = sync.getSyncStatus();
  check('same-org colleague not blocked', status.phase !== 'blocked', status.phase);
  account = await db.syncAccountRepo.get();
  check('colleague re-stamped', account?.userId === 'user-2', JSON.stringify(account));

  // 4. Different org on a device WITH data: parks.
  await sync.configureSync({ userId: 'user-3', isAdmin: true, orgId: 'org-B' });
  status = sync.getSyncStatus();
  check('cross-org with data BLOCKED', status.phase === 'blocked', status.phase);
  account = await db.syncAccountRepo.get();
  check('stamp still org-A while blocked', account?.orgId === 'org-A', JSON.stringify(account));
  const customers = await db.customersRepo.all();
  check('org-A data untouched while blocked', customers.length === 1, String(customers.length));

  // 5. runSync while blocked must also park (defense in depth).
  await sync.runSync();
  status = sync.getSyncStatus();
  check('runSync also blocked', status.phase === 'blocked', status.phase);

  // 6. The explicit way out: clear the device.
  await sync.clearDeviceForNewCompany();
  const after = await db.customersRepo.all();
  check('clear wiped customers', after.length === 0, String(after.length));
  account = await db.syncAccountRepo.get();
  check('clear re-stamped org-B', account?.orgId === 'org-B', JSON.stringify(account));
  await sync.configureSync({ userId: 'user-3', isAdmin: true, orgId: 'org-B' });
  status = sync.getSyncStatus();
  check('unblocked after clear', status.phase !== 'blocked', status.phase);

  // 7. Different org on an EMPTY device: moves across silently.
  await sync.configureSync({ userId: 'user-4', isAdmin: true, orgId: 'org-C' });
  status = sync.getSyncStatus();
  check('empty device handover not blocked', status.phase !== 'blocked', status.phase);
  account = await db.syncAccountRepo.get();
  check('empty handover stamped org-C', account?.orgId === 'org-C', JSON.stringify(account));

  return out;
});

let failed = 0;
for (const { name, ok, detail } of results) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed += 1;
}
await browser.close();
if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nORG GUARD CHECKS PASSED');
process.exit(0);
