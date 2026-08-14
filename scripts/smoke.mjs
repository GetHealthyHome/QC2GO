// End-to-end smoke test: creates a job, runs a full inspection with a documented
// deficiency, signs off, and verifies everything survives a hard reload.
// Usage: npm run build && npm run preview &  then  node scripts/smoke.mjs
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import zlib from 'node:zlib';
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
  // The office export is a real download; without this Playwright cancels it.
  acceptDownloads: true,
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

/**
 * A valid PNG, built rather than pasted.
 *
 * The base64 blob that used to live here had a corrupt IDAT chunk — bad CRC,
 * and the compressed data would not inflate. Nothing ever said so: the app
 * falls back to storing the original file when an image cannot be decoded, so
 * every photo assertion still passed while the downscale and watermark path
 * they were meant to cover was never once executed. A fixture that silently
 * disables the code it is testing is worse than no fixture.
 *
 * Mid-grey so that the dark stamp bar burned across the bottom is measurably
 * darker than the rest of the frame.
 */
function makePng(width = 240, height = 180, level = 190) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    raw.fill(level, row + 1, row + 1 + width * 3);
  }

  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = makePng();

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

/**
 * Answer a run of dialogs in order. `page.once` will not do: several one-time
 * listeners all fire on the *first* dialog, so the second one finds it already
 * handled. `null` dismisses, a string accepts a prompt with that text, and
 * `true` accepts an alert.
 */
async function withDialogs(answers, action) {
  let next = 0;
  const handler = async (dialog) => {
    const answer = answers[next++];
    if (answer === null || answer === undefined) await dialog.dismiss();
    else if (answer === true) await dialog.accept();
    else await dialog.accept(answer);
  };
  page.on('dialog', handler);
  try {
    await action();
    await page.waitForTimeout(500);
  } finally {
    page.off('dialog', handler);
  }
}

// --- walk every section ---
const chips = page.locator('[data-active]');
const chipCount = await chips.count();
check('checklist has job info step plus sections', chipCount > 1, chipCount);

// The step list grows as repeatable sections gain instances, so the count is
// re-read each time round rather than fixed before the walk starts.
let addedHeads = 0;
// Deliberately awkward: a lower-case l and a zero, the two characters somebody
// transcribing by hand gets wrong, and the whole reason the camera is better.
const SERIALS = ['OUTDOOR-9F2K1l80', 'HEAD-A-22B7', 'HEAD-B-0O0B9'];
let serialsFilled = false;
for (let s = 1; s < (await chips.count()); s++) {
  await chips.nth(s).click();
  await page.waitForTimeout(250);
  if (s === 1) await shot('07-universal-section');

  // A repeatable section with nothing added yet offers a button instead of
  // questions. Add two, so the run covers more than the single-instance case —
  // failing the same checkpoint on two heads has to be two separate items.
  const addFirst = page.getByRole('button', { name: /^Add head$/i });
  if (await addFirst.count()) {
    for (const name of ['Primary bedroom', 'Living room']) {
      const button = page.getByRole('button', { name: /^Add (another )?head$/i }).first();
      await withDialogs([name], () => button.click());
      addedHeads += 1;
    }
    await shot('07b-heads-added');
    // The section step has been replaced by one step per head; come back to the
    // same index, which is now the first of them.
    s -= 1;
    continue;
  }

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
        // Local mode has no server to ask, so the AI affordance must not be
        // here at all. A button that is present and always fails is worse than
        // one that is absent — it reads as a broken app rather than as a
        // deployment without a backend.
        check(
          'no AI affordance where there is no backend to ask',
          (await card.getByRole('button', { name: 'Tidy up' }).count()) === 0,
        );
        await shot('09-deficiency-documented');
        continue;
      }
      await yes.click();

      // Serial numbers. Until now these existed only as pixels in a photo of
      // the data plate — unsearchable, absent from the export, and useless for
      // a warranty claim without somebody squinting at an image. Typed here
      // rather than scanned because headless Chromium has no camera; the
      // decode-to-field path is covered by check:barcode.
      const serials = card.getByPlaceholder('One per line');
      if (await serials.count()) {
        await serials.fill(SERIALS.join('\n'));
        serialsFilled = true;
      }
    } else {
      const value = card.locator('input[type="text"]');
      if (await value.count()) await value.fill('412');
    }
  }
  if (s === 1) await shot('10-section-complete');
}

check('the serial checkpoint offers somewhere to put the numbers', serialsFilled);
check('a repeatable section accepted two instances', addedHeads === 2, addedHeads);
const headSteps = await page.getByRole('button', { name: /Primary bedroom|Living room/ }).count();
check('each head became its own step', headSteps >= 2, headSteps);

// --- marking up the deficiency photo ---
//
// The point of the annotator is that it lands the mark in the same place on a
// phone, in a report and on paper. So this drags a real arrow with real pointer
// events and then reads back what was stored.
console.log('--- photo annotation ---');
// Back to the section holding the documented deficiency — the bare inspection
// URL opens on Job Information, which has no photos on it.
await page.goto(inspectionUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-active]').nth(1).click();
await page.waitForTimeout(500);
await page.locator('img[src^="blob:"]').first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Mark up/ }).click();
await page.waitForTimeout(400);

const surface = page.locator('.touch-none').first();
const box = await surface.boundingBox();
check('the annotator opened over the photo', box !== null, JSON.stringify(box));

// A diagonal drag across the middle of the image.
await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, { steps: 8 });
await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
await shot('09b-annotator');

await page.getByRole('button', { name: 'Done', exact: true }).click();
await page.waitForTimeout(500);
// Done returns to the viewer showing the marks; close that too.
await page.getByRole('button', { name: 'Close' }).click();
await page.waitForTimeout(400);

const marks = await page.evaluate(
  (id) =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open('qc2go');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const request = open.result
          .transaction('photos', 'readonly')
          .objectStore('photos')
          .index('inspectionId')
          .getAll(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result?.[0]?.annotations ?? null);
      };
    }),
  inspectionUrl.split('/').pop(),
);

check('the arrow was stored', Array.isArray(marks) && marks.length === 1, JSON.stringify(marks));
check(
  'it was stored as a fraction of the image, not as pixels',
  marks?.[0]?.points?.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
  JSON.stringify(marks?.[0]?.points),
);
check(
  'it points roughly where it was dragged',
  Math.abs(marks?.[0]?.points?.[0]?.x - 0.25) < 0.06 &&
    Math.abs(marks?.[0]?.points?.[1]?.x - 0.7) < 0.06,
  JSON.stringify(marks?.[0]?.points),
);

// Put the walk back where it was. This block navigated away to reach the
// photo, and everything after it expects to be standing on the last section,
// which is the only step that offers the review link.
const steps = page.locator('[data-active]');
await steps.nth((await steps.count()) - 1).click();
await page.waitForTimeout(400);

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

// The marks are drawn over the image rather than into it, so the report has to
// render them itself — this is where they would silently vanish.
check(
  'the report draws the mark over the photo',
  (await page.locator('svg path[stroke]').count()) > 0,
  await page.locator('svg path[stroke]').count(),
);


/** Reads an inspection straight out of IndexedDB, past anything the UI derives. */
async function storedInspection() {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('qc2go');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result
            .transaction('inspections', 'readonly')
            .objectStore('inspections')
            .get(id);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error);
        };
      }),
    inspectionUrl.split('/').pop(),
  );
}

// The provenance is burned into the pixels, so it survives being exported,
// printed or pulled out of a report. Nothing in the DOM reports that, so this
// reads the stored photo back and samples the strip where the stamp is drawn.
console.log('--- photo provenance ---');
const stamp = await page.evaluate(async (id) => {
  // Read the record out of IndexedDB first and finish with it there. Awaiting
  // inside an IndexedDB callback lets the whole chain be collected mid-flight,
  // which surfaces as "resulting promise was garbage collected".
  const photo = await new Promise((resolve, reject) => {
    const open = indexedDB.open('qc2go');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result
        .transaction('photos', 'readonly')
        .objectStore('photos')
        .index('inspectionId')
        .getAll(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result?.[0] ?? null);
    };
  });
  if (!photo?.blob) return { error: 'no photo record with bytes' };

  let bitmap;
  try {
    bitmap = await createImageBitmap(photo.blob);
  } catch (problem) {
    // Report rather than crash the run: what the bytes turned out to be is the
    // useful part of this failing.
    return { error: String(problem), size: photo.blob.size, type: photo.blob.type };
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const paint = canvas.getContext('2d');
  paint.drawImage(bitmap, 0, 0);

  // The stamp sits on a dark bar across the bottom. Sample a row inside it and
  // one well above, and compare how bright they are.
  const brightness = (data) => {
    let total = 0;
    for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
    return total / (data.length / 4);
  };
  return {
    watermarked: photo.watermarked,
    bottom: brightness(paint.getImageData(0, bitmap.height - 12, bitmap.width, 1).data),
    middle: brightness(paint.getImageData(0, Math.round(bitmap.height / 2), bitmap.width, 1).data),
    width: bitmap.width,
  };
}, inspectionUrl.split('/').pop());

check('the photo was watermarked', stamp?.watermarked === true, JSON.stringify(stamp));
check(
  'a dark stamp bar is present along the bottom',
  stamp !== null && stamp.bottom < stamp.middle,
  JSON.stringify({ bottom: Math.round(stamp?.bottom), middle: Math.round(stamp?.middle) }),
);
check('the photo was downscaled to the long-edge limit', stamp?.width <= 1600, stamp?.width);

// The score is derived on every read inside the app, and written down once at
// sign-off for everything outside it. Nothing on screen distinguishes the two,
// so this reads the record itself.
const signed = await storedInspection();
console.log('--- the result, written down ---');
check('sign-off stored a score', typeof signed?.overallScore === 'number', signed?.overallScore);
check(
  'sign-off stored a verdict in the shared vocabulary',
  ['PASS', 'FAIL', 'NEEDS_REVIEW'].includes(signed?.passFailStatus),
  signed?.passFailStatus,
);
check(
  'the one failed item is counted as a deficiency',
  signed?.totalDeficiencies === 1,
  signed?.totalDeficiencies,
);
check(
  'the serials were stored as data, not just photographed',
  signed?.responses?.['u-serials']?.value === SERIALS.join('\n'),
  JSON.stringify(signed?.responses?.['u-serials']?.value),
);
const serialReport = await page.locator('body').innerText();
check(
  'and every one of them is on the report',
  SERIALS.every((serial) => serialReport.includes(serial)),
  SERIALS.filter((serial) => !serialReport.includes(serial)).join(', '),
);

// --- the punch list gathers what is still open across the whole job ---
//
// One checkpoint was failed and documented above, so the customer should now
// have exactly one open item — reachable without opening the inspection it
// came from, which is the entire point of the screen.
console.log('--- punch list ---');
await page.goto(customerUrl + '/punch', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const punchText = await page.locator('body').innerText();
check('the failed checkpoint appears as an open punch item', punchText.includes('Permit'), 
  JSON.stringify(punchText.slice(0, 140)));
check('its explanation came with it', punchText.includes('Concord building department'));

// --- putting somebody's name on a deficiency ---
//
// The lifecycle rules are asserted in `check:tasks`. What only a browser can
// show is that raising a task from a punch item ties the two together — and
// above all that closing it in one place closes it in the other, because a
// deficiency that reads as corrected on one screen and open on another is the
// failure that makes people stop believing both.
console.log('--- work orders ---');
await page.getByRole('button', { name: /Raise a work order/ }).first().click();
await page.waitForTimeout(400);
check(
  'a raised work order shows on the punch item, owned by nobody',
  /nobody yet/i.test(await page.locator('body').innerText()),
);

await page.goto(BASE + '/#/tasks', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const board = await page.locator('body').innerText();
check('the work order reached the board', board.includes('Permit'), JSON.stringify(board.slice(0, 200)));
// Uppercased by CSS on the card, and innerText reports what is rendered.
check('and carries the customer it belongs to', /dana whitfield/i.test(board));
check(
  'an unowned task offers no way forward until it has a name on it',
  /give this task to somebody/i.test(board),
  JSON.stringify(board.slice(0, 400)),
);
// This checkpoint carries no guidance line on the shipped checklist, so there
// is nothing to inherit — and the board asks for it rather than leaving a
// verifier to work out the standard for themselves. (The inheriting case is
// covered in `check:tasks`, where a checkpoint with `help` can be constructed.)
check(
  'a task with nothing to verify against asks somebody to say what to check',
  /say what to check before verifying/i.test(board),
  JSON.stringify(board.slice(0, 500)),
);

// Typed rather than picked: the roster pick list is empty on a company that
// has not filled it in, and a board nobody can assign anybody on is frozen.
await page.getByLabel('Assigned to').first().fill('M. Okafor');
await page.waitForTimeout(600);
const owned = await page.locator('body').innerText();
check('assigning it opens up the lifecycle', /assigned/i.test(owned));
check(
  'THE POINT OF SIX STATES: it cannot be verified before anybody says it is done',
  !(await page.getByRole('button', { name: /^Verified$/ }).count()),
  'Verified was offered straight from New',
);
await shot('15c2-work-order', true);

await page.goto(customerUrl + '/punch', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await withDialogs(['Permit pulled and posted on site'], () =>
  page.getByRole('button', { name: /Mark corrected/ }).first().click(),
);
const afterClose = await page.locator('body').innerText();
check('marking it corrected empties the open list', /nothing outstanding/i.test(afterClose));
check('the correction note is kept', afterClose.includes('Permit pulled and posted on site')
  || /corrected \(1\)/i.test(afterClose));
await shot('15c-punch-list', true);

// THE TWO TRUTHS: the board has to agree, without anybody having touched it.
await page.goto(BASE + '/#/tasks', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check(
  'correcting the deficiency closed its work order too',
  !/permit/i.test(await page.locator('body').innerText()),
  'the board still shows an open work order for a corrected deficiency',
);
await page.getByRole('button', { name: /^All \(/ }).click();
await page.waitForTimeout(300);
check(
  'and it reads as verified rather than having vanished',
  /verified/i.test(await page.locator('body').innerText()),
);

await page.goto(customerUrl + '/punch', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// Closing a punch item must not touch the inspection that raised it — a signed
// inspection is a record, and this is the change most likely to erode that.
const stillSigned = await storedInspection();
const stillFailing = Object.values(stillSigned?.responses ?? {}).filter(
  (response) => response?.answer === 'no',
).length;
check(
  'closing a punch item left the signed inspection alone',
  stillSigned?.status === 'completed' && stillFailing === 1,
  JSON.stringify({ status: stillSigned?.status, failing: stillFailing }),
);

// --- the office export ---
//
// A file the office opens once a month is exactly the kind of thing that breaks
// silently, so this downloads it for real and reads the bytes back.
console.log('--- csv export ---');
await page.goto(BASE + '/#/completed', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Checkpoints' }).click(),
]);
const csvPath = await download.path();
const csv = fs.readFileSync(csvPath, 'utf8');

check('the export downloads with a dated filename', /qc2go-checkpoints-\d{4}-\d{2}-\d{2}\.csv/.test(download.suggestedFilename()), download.suggestedFilename());
check('it starts with a byte-order mark so Excel reads it as UTF-8', csv.charCodeAt(0) === 0xfeff);
check('the failed checkpoint is in it with its explanation', csv.includes('Concord building department'));
// The point of capturing serials as data rather than as a photograph: the
// office can pull them out of a file instead of reading them off an image.
check(
  'every serial number reached the spreadsheet',
  SERIALS.every((serial) => csv.includes(serial)),
  SERIALS.filter((serial) => !csv.includes(serial)).join(', '),
);
check(
  'the multi-line serial cell did not break the row',
  csv.includes(`"${SERIALS.join('\n')}"`),
  'serials were not quoted as one cell',
);
// The address lives in the other export, so download that one too.
const [summaryDownload] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Inspections' }).click(),
]);
const summary = fs.readFileSync(await summaryDownload.path(), 'utf8');

check(
  'the address with commas in it stayed in one cell',
  summary.includes('"118 Marsh Rd, Concord, MA"'),
  JSON.stringify(summary.split('\r\n')[1]?.slice(0, 160)),
);
check(
  'the inspection export carries the stored score and verdict',
  /,(?:100|\d{1,2}),(?:PASS|FAIL|NEEDS_REVIEW),/.test(summary),
  JSON.stringify(summary.split('\r\n')[1]?.slice(0, 200)),
);
// Every row must have the same number of fields as the header, or the file is
// misaligned in a way a spreadsheet will not complain about.
const lines = csv.replace(/^\ufeff/, '').split('\r\n').filter(Boolean);
const fieldCount = (line) => (line.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) ?? []).length + 1;
const headerFields = fieldCount(lines[0]);
const ragged = lines.filter((line) => fieldCount(line) !== headerFields);
check('every row has the same shape as the header', ragged.length === 0, `${ragged.length} ragged rows`);
await shot('15d-export');

// --- the customer deliverable is a file, not the print dialog ---
//
// `check:pdf-layout` proves where the blocks go; nothing there proves pdf-lib
// draws anything, that the fonts embed, or that a photo taken by the camera
// survives being flattened and embedded. That only happens in a browser.
console.log('--- the report PDF ---');
await page.goto(inspectionUrl + '/report', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

async function grabPdf() {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download PDF/ }).click(),
  ]);
  const bytes = fs.readFileSync(await download.path());
  // Kept beside the screenshots: when a layout check fails on CI, the file
  // itself is the only thing that shows what actually went wrong.
  fs.writeFileSync(`${OUT}/${download.suggestedFilename()}`, bytes);
  return {
    name: download.suggestedFilename(),
    bytes,
    raw: bytes.toString('latin1'),
    doc: await PDFDocument.load(bytes),
    get text() {
      return pdfStreamText(bytes);
    },
  };
}

/**
 * What the pages actually say.
 *
 * A PDF's objects and content streams are Flate-compressed, so grepping the
 * file for a serial number finds nothing whether or not it was drawn — which
 * would make a "the text is there" check pass on an empty document. Inflating
 * every stream first is the difference between asserting on the report and
 * asserting on the file header.
 */
function pdfStreamText(buffer) {
  const marker = Buffer.from('stream');
  const end = Buffer.from('endstream');
  const parts = [];
  let at = 0;
  while (at < buffer.length) {
    const start = buffer.indexOf(marker, at);
    if (start === -1) break;
    let from = start + marker.length;
    if (buffer[from] === 0x0d) from += 1;
    if (buffer[from] === 0x0a) from += 1;
    const stop = buffer.indexOf(end, from);
    if (stop === -1) break;
    try {
      parts.push(zlib.inflateSync(buffer.subarray(from, stop)).toString('latin1'));
    } catch {
      parts.push(buffer.subarray(from, stop).toString('latin1'));
    }
    at = stop + end.length;
  }
  // pdf-lib writes every string as hex — `<514332474F> Tj` rather than
  // `(QC2GO) Tj` — so the drawn words are not searchable until they are
  // decoded back to bytes.
  return parts
    .join('\n')
    .replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_, hex) => Buffer.from(hex, 'hex').toString('latin1'));
}

const report = await grabPdf();
const { bytes: pdfBytes, raw: pdfRaw, text: pdfText } = report;

check(
  'the report downloads as a PDF',
  pdfBytes.subarray(0, 5).toString('latin1') === '%PDF-',
  JSON.stringify(pdfBytes.subarray(0, 16).toString('latin1')),
);
// A truncated PDF opens as a blank page in some readers and not at all in
// others, which is the kind of thing a customer reports and nobody can
// reproduce.
check(
  'the file is not truncated',
  pdfRaw.slice(-2048).includes('%%EOF'),
  `${pdfBytes.length} bytes`,
);
const pdfPages = report.doc.getPageCount();
check('it has at least one page', pdfPages >= 1, `${pdfPages} pages`);
check(
  'the file is named after the customer',
  report.name.startsWith('dana-whitfield'),
  report.name,
);
// The photos are the bulk of a report, and a build that quietly embedded none
// of them still produces a valid, plausible-looking file.
check(
  'the evidence photos are embedded',
  pdfRaw.includes('/DCTDecode'),
  `${pdfBytes.length} bytes, ${pdfPages} pages`,
);
check(
  'a serial number reached the page',
  pdfText.includes(SERIALS[0]),
  'the monospaced serial block is missing from the PDF',
);
check(
  'the words on the page are the report',
  pdfText.includes('Dana Whitfield') && pdfText.includes('SIGNATURES'),
  'the customer name or the signature block is missing',
);
await shot('15e-pdf');

// --- reopening a signed record demands a reason and keeps it ---
//
// This is the one action in the app that rewrites history, so the interesting
// case is the refusal: cancelling, or entering nothing, must leave the record
// signed.
console.log('--- reopening a signed inspection ---');

// Back to the report: the punch list left the browser on a different screen,
// and every assertion below is about the button that lives on this one.
await page.goto(inspectionUrl + '/report', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const reopenButton = page.getByRole('button', { name: /Reopen for editing/ });

await withDialogs([null], () => reopenButton.click());
check(
  'cancelling the reason leaves the record signed',
  (await page.locator('body').innerText()).includes('Completed'),
);

// An empty reason is refused the same way — the prompt, then the alert saying why.
await withDialogs(['', true], () => reopenButton.click());
check(
  'an empty reason is refused',
  (await page.locator('body').innerText()).includes('Completed'),
);

const REASON = 'Permit number was captured from the wrong job';
await withDialogs([REASON], () => reopenButton.click());

// Straight to the report route: the record is in progress again now, so the
// bare inspection URL lands on the runner rather than redirecting here.
await page.goto(inspectionUrl + '/report', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const reopened = await page.locator('body').innerText();
check('the reason is recorded on the report', reopened.includes(REASON));
// Section headings are uppercased by CSS, and innerText reports what is
// rendered rather than what is in the markup.
check('the report says it was reopened', /reopened after signing/i.test(reopened));

// The verdict belonged to the sign-off that produced it. Leaving it behind
// would let a webhook or a spreadsheet report a result on a record that no
// longer has one.
const afterReopen = await storedInspection();
check(
  'reopening cleared the stored result',
  afterReopen?.overallScore === undefined && afterReopen?.passFailStatus === undefined,
  JSON.stringify({ score: afterReopen?.overallScore, status: afterReopen?.passFailStatus }),
);

await shot('15b-reopened', true);

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
//
// "New checklist" opens a form and writes nothing until Create is pressed. It
// used to write the record on the first press, which is what put an "Untitled
// checklist" in the library for the next person to find — and, because the
// editor keeps its changes in a draft, made a typed name look saved when what
// was stored was still the placeholder.
await page.goto(BASE + '/#/checklists', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New checklist' }).click();
await page.waitForURL(/checklists\/new/);

// THE REGRESSION: abandoning the form leaves the library exactly as it was.
await page.getByLabel('Checklist name').fill('Abandoned Draft');
await withDialogs([true], async () => {
  await page.getByRole('button', { name: 'Cancel' }).click();
});
await page.waitForTimeout(400);
check(
  'abandoning the new-checklist form writes nothing',
  (await page.getByText('Abandoned Draft').count()) === 0 &&
    (await page.getByText('Untitled checklist').count()) === 0,
);

await page.getByRole('button', { name: 'New checklist' }).click();
await page.waitForURL(/checklists\/new/);
await page.getByLabel('Checklist name').fill('Attic Prep Pre-Install');
// A choice now, not typed text: two spellings of one category are two groups
// on the picker and one kind of work.
await page.getByLabel('Category').selectOption('home-performance');
await page.getByLabel('Description').fill('Walked before the crew starts insulation.');
check(
  'no checkpoint suggestions on the new-checklist form where there is no backend',
  (await page.getByRole('button', { name: 'Suggest checkpoints' }).count()) === 0,
);
await shot('20-new-checklist');
await page.getByRole('button', { name: 'Create checklist' }).click();
await page.waitForURL(/checklists\/tpl_/);
const atticEditorUrl = page.url();
check(
  'the checklist was created with what was typed, not a placeholder',
  (await page.getByLabel('Checklist name').inputValue()) === 'Attic Prep Pre-Install' &&
    (await page.getByLabel('Category').inputValue()) === 'home-performance',
);
await page.getByRole('button', { name: 'Add section' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Section title').fill('Access & Safety');
await page.getByPlaceholder('What is the inspector checking?').first()
  .fill('Attic access is clear and safe to enter');
// Local mode has no server to ask, so the second AI affordance is absent for
// the same reason the first one is: a button that is always going to fail
// reads as a broken app rather than as a deployment without a backend.
check(
  'no checkpoint suggestions where there is no backend to ask',
  (await page.getByRole('button', { name: 'Suggest checkpoints' }).count()) === 0,
);
await shot('20b-new-section');
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

// --- conditional logic: a checkpoint that only applies sometimes ---
//
// Authored in the editor and then walked, because the failure this has to rule
// out is an end-to-end one: a hidden question that still blocks sign-off leaves
// a blocker naming a checkpoint that is nowhere on screen, which nobody can
// clear and no amount of scrolling explains.
const ROUTER = 'Walkboards installed where required';
const DEPENDENT = 'Attic access is clear and safe to enter';

await page.goto(atticEditorUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: /Access & Safety/ }).first().click();
await page.waitForTimeout(300);

// The first checkpoint becomes a fact about the job rather than a standard, so
// answering it No is an answer and not a deficiency demanding a photograph.
await page.getByRole('button', { name: 'Fact, not a standard' }).first().click();
await page.waitForTimeout(200);

const conditionSelect = page.getByLabel('Only ask this when');
check(
  'only earlier checkpoints can be depended on',
  (await conditionSelect.count()) === 1,
  `${await conditionSelect.count()} condition editors`,
);
await conditionSelect.selectOption({ label: ROUTER });
await page.waitForTimeout(200);
await shot('26-condition-authored');
await page.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(700);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.getByRole('button', { name: /Access & Safety/ }).first().click();
await page.waitForTimeout(300);
check(
  'the condition survived a save and reload',
  (await page.getByLabel('Only ask this when').inputValue()) !== '',
  await page.getByLabel('Only ask this when').inputValue(),
);

// Now walk it.
await page.goto(customerUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('checkbox', { name: /Attic Prep Pre-Install/ }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Attic Prep Pre-Install.*Start/s }).click();
await page.waitForURL(/\/inspections\//);
const atticUrl = page.url().replace(/\?.*$/, '');
await page.waitForTimeout(400);

// Straight to the section by name. Not by index — every checklist gets the
// shared Universal section prepended, so position 1 is not this one.
await page.locator('[data-active]').filter({ hasText: 'Access & Safety' }).first().click();
await page.waitForTimeout(400);
const beforeAnswer = await page.locator('body').innerText();
check(
  'a dependent checkpoint is not asked before its condition is answered',
  beforeAnswer.includes(ROUTER) && !beforeAnswer.includes(DEPENDENT),
  JSON.stringify(beforeAnswer.slice(0, 200)),
);
await shot('27-condition-hidden');

const routerCard = page.locator('article').filter({ hasText: ROUTER });
await routerCard.getByRole('button', { name: 'Yes', exact: true }).click();
await page.waitForTimeout(400);
check(
  'answering it Yes reveals the dependent checkpoint',
  (await page.locator('body').innerText()).includes(DEPENDENT),
);
await shot('28-condition-revealed');

await routerCard.getByRole('button', { name: 'No', exact: true }).click();
await page.waitForTimeout(400);
const afterNo = await page.locator('body').innerText();
check(
  'and answering it No hides it again',
  !afterNo.includes(DEPENDENT),
  JSON.stringify(afterNo.slice(0, 200)),
);
check(
  'a fact answered No does not demand an explanation and a photo',
  !/explanation is required/i.test(afterNo),
  JSON.stringify(afterNo.slice(0, 300)),
);

// The record has to be able to explain itself. A skipped question and one
// quietly dropped from the checklist look identical — absent — unless the
// report says which happened.
await page.goto(atticUrl + '/report', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const atticReport = await page.locator('body').innerText();
check(
  'the report says what was not applicable, and why',
  /not applicable to this job/i.test(atticReport) &&
    atticReport.includes(DEPENDENT) &&
    atticReport.includes(ROUTER),
  JSON.stringify(atticReport.slice(0, 300)),
);
await shot('29-condition-report', true);

// The same audit property has to hold in the file the customer keeps, not only
// on the screen the inspector is looking at.
const atticPdf = await grabPdf();
check(
  'the PDF also states what was not applicable',
  atticPdf.text.includes('NOT APPLICABLE TO THIS JOB') &&
    atticPdf.text.includes(ROUTER),
  'a conditional block vanished from the deliverable instead of being explained',
);

// --- record checks: does this look like it was actually walked? ---
//
// This run is the ideal fixture for it: Playwright answered twenty checkpoints
// in a couple of seconds, which is exactly the pattern the velocity check
// exists to notice. The inspection was reopened earlier, so re-sign it first —
// the signatures survived, so completing is one button.
await page.goto(inspectionUrl + '/review', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Complete inspection' }).click();
await page.waitForURL(/\/report/);
await page.waitForTimeout(900);

const asAdmin = await page.locator('body').innerText();
check('an admin sees the record checks on a signed report', /record checks/i.test(asAdmin));
check(
  'a run answered in seconds is flagged as unusually fast',
  /unusually fast/i.test(asAdmin),
  JSON.stringify(asAdmin.slice(0, 200)),
);
await shot('30-record-checks', true);

// Not secret, but not shown to the person being measured either: telling them
// where the line sits is how you teach them to pace just above it.
await page.goto(BASE + '/#/settings', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /^Inspector/ }).click();
await page.waitForTimeout(400);
await page.goto(inspectionUrl + '/report', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const asInspector = await page.locator('body').innerText();
check(
  'an inspector does not see them on their own report',
  !/record checks/i.test(asInspector) && !/unusually fast/i.test(asInspector),
  JSON.stringify(asInspector.slice(0, 200)),
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
