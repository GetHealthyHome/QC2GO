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

// --- create a job ---
await page.getByRole('button', { name: 'Add first job' }).click();
await page.getByLabel('Job name').fill('Marsh Rd — Whole Home Retrofit');
await page.getByLabel('Customer name').fill('Dana Whitfield');
await page.getByLabel('Job address').fill('118 Marsh Rd, Concord, MA');
await page.getByLabel('Customer phone').fill('(978) 555-0143');
await page.getByLabel('Salesperson').fill('R. Alvarez');
await page.getByLabel('Team leader').fill('M. Okafor');
await page.getByLabel('Job / work order #').fill('WO-4471');
await shot('02-new-job');
await page.getByRole('button', { name: 'Create job' }).click();
await page.waitForURL(/\/jobs\//);
await shot('03-job-detail');

// --- start an inspection ---
await page.getByRole('link', { name: 'Start inspection' }).click();
await shot('04-template-picker');
await page.getByRole('button', { name: /Mitsubishi Ductless Hyper-Heat/ }).click();
await page.waitForURL(/\/inspections\//);
const inspectionUrl = page.url();
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
console.log('steps:', chipCount);

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
await shot('13-report');
await shot('13-report-full', true);

// back to jobs list with data present
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await shot('14-jobs-list');

// hard reload straight into the report to prove IndexedDB persistence
await page.goto(inspectionUrl, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const text = await page.locator('body').innerText();
console.log('--- after hard reload ---');
console.log('url:', page.url());
console.log('has job name :', text.includes('Marsh Rd'));
console.log('is completed :', text.includes('Completed'));
console.log('has note     :', text.includes('Concord building department'));
console.log('has photo    :', await page.locator('img[src^="blob:"]').count(), 'blob images');
console.log('has signature:', await page.locator('img[src^="data:image/png"]').count(), 'signatures');
await shot('15-report-after-reload', true);

console.log('\nCONSOLE ERRORS:', errors.length ? errors : 'none');
await browser.close();
