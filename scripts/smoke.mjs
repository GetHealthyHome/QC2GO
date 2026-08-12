// End-to-end smoke test: creates a job, runs a full inspection with a documented
// deficiency, signs off, and verifies everything survives a hard reload.
// Usage: npm run build && npm run preview &  then  node scripts/smoke.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173';
const OUT = process.env.SMOKE_OUT ?? 'smoke-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

/**
 * Assertions have to be able to fail the process — a smoke test that only logs is
 * decoration, not a gate. Failures are collected so one bad check does not hide
 * the rest, then the run exits non-zero at the end.
 */
const failures = [];
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` (got: ${detail})`}`);
  }
}

const shot = async (name, full = false) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log('shot:', name);
};

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAV0lEQVR4nO3PMQ0AMAzAsPIn3dHoQyXbBPLuzsz3Vwf8ygRlgjJBmaBMUCYoE5QJygRlgjJBmaBMUCYoE5QJygRlgjJBmaBMUCYoE5QJygRlgjJBmaAeVbwBLQ2m+8IAAAAASUVORK5CYII=',
  'base64',
);

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await shot('01-empty');

// --- create a customer ---
await page.getByRole('button', { name: 'Add first customer' }).click();
await page.getByLabel('Customer name').fill('Dana Whitfield');
await page.getByLabel('Job address').fill('118 Marsh Rd, Concord, MA');
await page.getByLabel('Customer phone').fill('(978) 555-0143');
await page.getByLabel('Salesperson').fill('R. Alvarez');
await page.getByLabel('Team leader').fill('M. Okafor');
await page.getByLabel('Job / work order #').fill('WO-4471');
await page.getByLabel('Work Scope / Job Notes').fill('Whole home retrofit: attic air seal + 3 zone ductless.');
await shot('02-new-customer');
await page.getByRole('button', { name: 'Create customer' }).click();
await page.waitForURL(/\/customers\/cust_/);
const customerUrl = page.url();
await shot('03-customer-detail');

// --- tick the checklists this job needs, then start one ---
await page.getByRole('checkbox', { name: /Mitsubishi Ductless Hyper-Heat/ }).click();
await page.waitForTimeout(300);
await shot('04-templates-checked');
check(
  'ticking a checklist reveals a start button',
  (await page.getByRole('button', { name: /Mitsubishi Ductless Hyper-Heat/ }).count()) > 0,
);
await page.getByRole('button', { name: /Mitsubishi Ductless Hyper-Heat.*Start/s }).click();
await page.waitForURL(/\/inspections\//);
const inspectionUrl = page.url().replace(/\?.*$/, '');
await shot('05-job-info');

await page.getByLabel('Inspected by').fill('A. Holcombe');
await page.getByLabel('Permit #').fill('CON-2026-0918');
await page.getByLabel('Crew members on site').fill('M. Okafor, J. Reyes');
await page.getByLabel('Outdoor temp (°F)').fill('38');
await page.getByLabel('Customer present for walkthrough').selectOption('Yes');
await shot('06-job-info-filled');

// --- walk every section ---
const chips = page.locator('[data-active]');
const chipCount = await chips.count();
check('checklist has job info step plus sections', chipCount > 1, chipCount);

for (let s = 1; s < chipCount; s++) {
  await chips.nth(s).click();
  await page.waitForTimeout(250);
  if (s === 1) await shot('07-universal-section');

  const cards = page.locator('article');
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const yes = card.getByRole('button', { name: 'Yes', exact: true });
    if (await yes.count()) {
      // Flag one item as a deficiency to exercise the required-evidence path.
      if (s === 1 && i === 2) {
        await card.getByRole('button', { name: 'No', exact: true }).click();
        await page.waitForTimeout(150);
        await shot('08-deficiency-open');
        await card
          .locator('textarea')
          .fill(
            'Permit is not posted on site and the rough inspection has not been scheduled. Office to schedule with the Concord building department before final.',
          );
        await card
          .locator('input[type="file"]')
          .setInputFiles({ name: 'permit.png', mimeType: 'image/png', buffer: png });
        await page.waitForTimeout(400);
        await shot('09-deficiency-documented');
        continue;
      }
      await yes.click();
    } else {
      const value = card.locator('input[type="text"]');
      if (await value.count()) await value.fill('412');
    }
  }
  if (s === 1) await shot('10-section-complete');
}

// --- review ---
await page.getByRole('link', { name: /Review/ }).click();
await page.waitForURL(/\/review/);
await shot('11-review');

// sign both — the saved pad replaces its canvas, so always target the first remaining one
for (let i = 0; i < 2; i++) {
  const canvas = page.locator('canvas').first();
  await canvas.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 95);
  await page.mouse.down();
  await page.mouse.move(box.x + 95, box.y + 40, { steps: 8 });
  await page.mouse.move(box.x + 150, box.y + 105, { steps: 8 });
  await page.mouse.move(box.x + 225, box.y + 45, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const pad = canvas.locator('xpath=ancestor::div[1]/..');
  await pad.getByRole('button', { name: 'Save signature' }).click();
  await page.waitForTimeout(300);
}
await shot('12-signed');

await page.getByRole('button', { name: 'Complete inspection' }).click();
await page.waitForURL(/\/report/);

// The letterhead holds a fixed area for the company logo whether or not there
// is one, so that adding a logo never reflows the report. With no logo the slot
// shows the company name — and it still has to occupy the same box.
const placeholder = await page
  .locator('div[style*="216px"]')
  .first()
  .boundingBox()
  .catch(() => null);
check(
  'the report reserves the logo slot even with no logo',
  placeholder !== null && Math.round(placeholder.width) === 216 && Math.round(placeholder.height) === 72,
  placeholder ? `${Math.round(placeholder.width)}x${Math.round(placeholder.height)}` : 'no slot found',
);

await shot('13-report');
await shot('13-report-full', true);

// back to the home screen with data present
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await shot('14-home-screen');

// hard reload straight into the report to prove IndexedDB persistence
await page.goto(inspectionUrl, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const text = await page.locator('body').innerText();
console.log('--- persistence after hard reload ---');
const photoCount = await page.locator('img[src^="blob:"]').count();
const sigCount = await page.locator('img[src^="data:image/png"]').count();
check('report route survives reload', /\/report$/.test(page.url()), page.url());
check('customer name persisted', text.includes('Dana Whitfield'));
check('completed status persisted', text.includes('Completed'));
check('deficiency note persisted', text.includes('Concord building department'));
check('deficiency photo persisted', photoCount >= 1, photoCount);
check('both signatures persisted', sigCount === 2, sigCount);
await shot('15-report-after-reload', true);

// --- admin checklist editor ---
await page.goto(BASE + '/#/settings', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /^Admin/ }).click();
await page.waitForTimeout(400);
await shot('16-settings-admin');

await page.getByRole('link', { name: /Manage checklists/ }).click();
await page.waitForURL(/checklists/);
await shot('17-checklists');

// edit the shared universal section — should touch every checklist
await page.getByRole('link', { name: /Job Information/ }).click();
await page.waitForURL(/checklists\/shared/);
await shot('18-shared-editor');
await page.getByRole('button', { name: /Universal QC Standards/ }).first().click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Add checkpoint' }).click();
await page.waitForTimeout(200);
const newQ = page.getByPlaceholder('What is the inspector checking?').last();
await newQ.scrollIntoViewIfNeeded();
await newQ.fill('Smart thermostat paired to homeowner Wi-Fi and app');
await shot('19-shared-added');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(600);

// build a brand new checklist from scratch
await page.goto(BASE + '/#/checklists', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New checklist' }).click();
await page.waitForURL(/checklists\/tpl_/);
await page.getByLabel('Checklist name').fill('Attic Prep Pre-Install');
await page.getByLabel('Category').fill('home-performance');
await page.getByLabel('Summary').fill('Walked before the crew starts insulation.');
await page.getByRole('button', { name: 'Add section' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Section title').fill('Access & Safety');
await page.getByPlaceholder('What is the inspector checking?').first()
  .fill('Attic access is clear and safe to enter');
await shot('20-new-checklist');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(600);

// reorder: move the new section's checkpoint list around
await page.getByRole('button', { name: 'Add checkpoint' }).click();
await page.waitForTimeout(200);
await page.getByPlaceholder('What is the inspector checking?').last()
  .fill('Walkboards installed where required');
await page.getByRole('button', { name: 'Move checkpoint up' }).last().click();
await page.waitForTimeout(200);
const orderAfterMove = await page.getByPlaceholder('What is the inspector checking?').first().inputValue();
check(
  'moving a checkpoint up reorders it',
  orderAfterMove === 'Walkboards installed where required',
  orderAfterMove,
);
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(600);
await shot('21-reordered');

// the new checklist shows up for inspectors
await page.goto(BASE + '/#/checklists', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
check(
  'admin-created checklist is listed',
  (await page.getByText('Attic Prep Pre-Install').count()) > 0,
);

// --- quick safety audit from the home screen, at a brand new address ---
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.getByRole('link', { name: /Safety audit/ }).click();
await page.waitForURL(/safety-audit/);
await shot('24-safety-audit-launcher');
await page.getByLabel('Customer name').fill('Reyes — 4 Oak St');
await page.getByLabel('Address').fill('4 Oak St, Acton, MA');
await page.getByRole('button', { name: 'Create and start audit' }).click();
await page.waitForURL(/\/inspections\//);
await page.waitForTimeout(500);
const auditText = await page.locator('body').innerText();
check('safety audit launches for a new customer', auditText.includes('Quick Safety Audit'));
await shot('25-safety-audit-running');

// --- the signed report must NOT have picked up the new universal question ---
await page.goto(inspectionUrl + '/report', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const reportText = await page.locator('body').innerText();
check(
  'signed report is NOT rewritten by a template edit',
  !reportText.includes('Smart thermostat paired'),
);
await shot('22-report-after-template-edit');

// but a NEW inspection on the same job does pick it up
await page.goto(customerUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Mitsubishi Ductless Hyper-Heat.*Run again/s }).click();
await page.waitForURL(/\/inspections\//);
await page.locator('[data-active]').nth(1).click();
await page.waitForTimeout(500);
const freshText = await page.locator('body').innerText();
check('a new inspection DOES pick up the template edit', freshText.includes('Smart thermostat paired'));
await shot('23-new-inspection-has-edit');

check('no console errors', errors.length === 0, errors.join(' | '));

await browser.close();

console.log('');
if (failures.length) {
  console.error(`SMOKE FAILED — ${failures.length} check(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('SMOKE PASSED');
