/**
 * The EXIF reader, against real bytes.
 *
 * This parser exists because canvas re-encoding destroys EXIF, so it has to run
 * on the untouched file — which means it is the only thing standing between a
 * photo's provenance and nothing. Byte-level parsing also fails quietly: a
 * wrong offset gives a plausible number rather than an error, and a missed
 * hemisphere reference puts a job on the wrong side of the equator.
 *
 * So the fixtures here are assembled by hand, byte by byte, rather than mocked.
 */
import { build } from 'vite';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'qc-exif-'));

await build({
  logLevel: 'error',
  build: {
    lib: {
      entry: new URL('../src/lib/exif.ts', import.meta.url).pathname,
      formats: ['es'],
      fileName: 'exif',
    },
    outDir: out,
    emptyOutDir: true,
    minify: false,
  },
});

const { readExif } = await import(join(out, 'exif.js'));

let failures = 0;
function check(name, fn) {
  return fn()
    .then(() => console.log(`  ok  ${name}`))
    .catch((error) => {
      failures += 1;
      console.log(`FAIL  ${name}\n      ${error.message.split('\n')[0]}`);
    });
}

// ---------------------------------------------------------------------------
// A JPEG with an EXIF APP1 segment, built by hand.
// ---------------------------------------------------------------------------

/**
 * @param options.date  DateTimeOriginal, EXIF format, or null to omit
 * @param options.gps   {lat: [d,m,s], latRef, lng: [d,m,s], lngRef} or null
 * @param options.littleEndian  byte order of the TIFF block
 */
function makeJpeg({ date = '2026:08:12 14:03:07', gps = null, littleEndian = true } = {}) {
  const chunks = [];
  // Everything is laid out relative to the start of the TIFF block, so build
  // that first and prefix the JPEG framing afterwards.
  const tiff = [];
  const u16 = (v) => {
    const b = Buffer.alloc(2);
    littleEndian ? b.writeUInt16LE(v) : b.writeUInt16BE(v);
    return b;
  };
  const u32 = (v) => {
    const b = Buffer.alloc(4);
    littleEndian ? b.writeUInt32LE(v) : b.writeUInt32BE(v);
    return b;
  };
  const rational = (n, d) => Buffer.concat([u32(n), u32(d)]);

  tiff.push(Buffer.from(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]));
  tiff.push(u16(0x002a));
  tiff.push(u32(8)); // IFD0 begins straight after the header

  // Values that do not fit in four bytes are parked past the IFDs.
  const heap = [];
  let heapCursor = 0;
  const HEAP_BASE = 512;
  const park = (buffer) => {
    const at = HEAP_BASE + heapCursor;
    heap.push(buffer);
    heapCursor += buffer.length;
    return at;
  };

  const EXIF_IFD_AT = 200;
  const GPS_IFD_AT = 320;

  const entry = (tag, type, count, valueOrOffset) =>
    Buffer.concat([
      u16(tag),
      u16(type),
      u32(count),
      Buffer.isBuffer(valueOrOffset) ? valueOrOffset : u32(valueOrOffset),
    ]);

  // --- IFD0: pointers only ---
  const ifd0 = [];
  if (date) ifd0.push(entry(0x8769, 4, 1, EXIF_IFD_AT));
  if (gps) ifd0.push(entry(0x8825, 4, 1, GPS_IFD_AT));
  tiff.push(u16(ifd0.length), ...ifd0, u32(0));

  // Pad out to where the sub-IFDs were promised to be.
  const padTo = (target) => {
    const soFar = tiff.reduce((total, buffer) => total + buffer.length, 0);
    if (soFar < target) tiff.push(Buffer.alloc(target - soFar));
  };

  padTo(EXIF_IFD_AT);
  if (date) {
    const value = Buffer.from(`${date}\0`, 'ascii');
    const at = park(value);
    tiff.push(u16(1), entry(0x9003, 2, value.length, at), u32(0));
  }

  padTo(GPS_IFD_AT);
  if (gps) {
    const latAt = park(
      Buffer.concat([rational(gps.lat[0], 1), rational(gps.lat[1], 1), rational(gps.lat[2] * 100, 100)]),
    );
    const lngAt = park(
      Buffer.concat([rational(gps.lng[0], 1), rational(gps.lng[1], 1), rational(gps.lng[2] * 100, 100)]),
    );
    const entries = [
      // A single-character ASCII value fits inline; the parser must read it
      // from the entry rather than following it as a pointer.
      entry(0x0001, 2, 2, Buffer.concat([Buffer.from(`${gps.latRef}\0`, 'ascii'), Buffer.alloc(2)])),
      entry(0x0002, 5, 3, latAt),
      entry(0x0003, 2, 2, Buffer.concat([Buffer.from(`${gps.lngRef}\0`, 'ascii'), Buffer.alloc(2)])),
      entry(0x0004, 5, 3, lngAt),
    ];
    tiff.push(u16(entries.length), ...entries, u32(0));
  }

  padTo(HEAP_BASE);
  tiff.push(...heap);

  const tiffBuffer = Buffer.concat(tiff);
  const app1Payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiffBuffer]);

  chunks.push(Buffer.from([0xff, 0xd8])); // SOI
  chunks.push(Buffer.from([0xff, 0xe1]));
  const length = Buffer.alloc(2);
  length.writeUInt16BE(app1Payload.length + 2);
  chunks.push(length, app1Payload);
  chunks.push(Buffer.from([0xff, 0xda])); // SOS — nothing past here is metadata
  return new Blob([Buffer.concat(chunks)]);
}

// ---------------------------------------------------------------------------

await check('reads the moment the shutter fired', async () => {
  const exif = await readExif(makeJpeg({ date: '2026:08:12 14:03:07' }));
  const taken = new Date(exif.takenAt);
  assert.equal(taken.getFullYear(), 2026);
  assert.equal(taken.getMonth(), 7);
  assert.equal(taken.getDate(), 12);
  assert.equal(taken.getHours(), 14);
  assert.equal(taken.getMinutes(), 3);
});

await check('reads coordinates north and east', async () => {
  const exif = await readExif(
    makeJpeg({ gps: { lat: [42, 27, 36], latRef: 'N', lng: [13, 30, 0], lngRef: 'E' } }),
  );
  assert.ok(Math.abs(exif.gps.lat - 42.46) < 0.001, `lat was ${exif.gps.lat}`);
  assert.ok(Math.abs(exif.gps.lng - 13.5) < 0.001, `lng was ${exif.gps.lng}`);
});

await check('THE ONE THAT MATTERS: south and west come back negative', async () => {
  // EXIF records both as positive numbers with a reference letter beside them.
  // Missing the sign puts a job in the wrong hemisphere — a plausible-looking
  // number, thousands of miles out, with nothing to indicate anything is wrong.
  const exif = await readExif(
    makeJpeg({ gps: { lat: [33, 51, 54], latRef: 'S', lng: [151, 12, 36], lngRef: 'W' } }),
  );
  assert.ok(exif.gps.lat < 0, `southern latitude came back as ${exif.gps.lat}`);
  assert.ok(exif.gps.lng < 0, `western longitude came back as ${exif.gps.lng}`);
  assert.ok(Math.abs(exif.gps.lat + 33.865) < 0.001, `lat was ${exif.gps.lat}`);
});

await check('reads big-endian files as well as little', async () => {
  // Byte order is per-file, and getting it wrong yields large plausible numbers
  // rather than an error.
  const exif = await readExif(
    makeJpeg({
      littleEndian: false,
      date: '2026:01:02 03:04:05',
      gps: { lat: [10, 0, 0], latRef: 'N', lng: [20, 0, 0], lngRef: 'E' },
    }),
  );
  assert.equal(new Date(exif.takenAt).getFullYear(), 2026);
  assert.ok(Math.abs(exif.gps.lat - 10) < 0.001, `lat was ${exif.gps.lat}`);
});

await check('a photo with no metadata is not an error', async () => {
  const exif = await readExif(makeJpeg({ date: null, gps: null }));
  assert.deepEqual(exif, {});
});

await check('a file that is not a JPEG at all is not an error', async () => {
  assert.deepEqual(await readExif(new Blob([Buffer.from('not an image')])), {});
  assert.deepEqual(await readExif(new Blob([])), {});
});

await check('truncated bytes do not throw', async () => {
  // Every phone produces the odd corrupt file, and losing the photo because its
  // metadata was cut short would be a far worse outcome than losing the metadata.
  const full = Buffer.from(await makeJpeg({ gps: { lat: [1, 2, 3], latRef: 'N', lng: [4, 5, 6], lngRef: 'E' } }).arrayBuffer());
  for (const cut of [4, 12, 40, 120, 300]) {
    assert.deepEqual(typeof (await readExif(new Blob([full.subarray(0, cut)]))), 'object');
  }
});

console.log(failures === 0 ? '\nAll EXIF checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
