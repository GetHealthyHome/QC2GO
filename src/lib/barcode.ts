/**
 * Reading a code off an equipment data plate.
 *
 * A serial number is the one field in this app where a single wrong character
 * costs real money — it is what warranty registration is keyed on, and nobody
 * finds out it was wrong until a compressor fails out of warranty. It is also
 * the field most likely to be wrong: typed with gloves on, off a plate behind a
 * unit, in a crawlspace, from a label that has been rained on.
 *
 * The camera does not make those mistakes.
 *
 * ## The engine, and what is missing
 *
 * `BarcodeDetector` is built into Chrome on Android and absent from Safari, so
 * on an iPhone this finds no engine and the field stays hand-typed. That is a
 * deliberate first step rather than an oversight: the fallback is a WebAssembly
 * decoder, which is a few hundred kilobytes that every device would have to
 * carry offline, and it is not worth adding until we know what the crews
 * actually hold in their hands.
 *
 * Everything below is written so that adding it is one function — `findEngine`
 * is the only place that knows what does the decoding, and nothing above this
 * module knows there is an engine at all.
 */

/**
 * What actually appears on HVAC and building-envelope equipment. The TRD asks
 * for fourteen formats; these four cover data plates, and every extra format is
 * another thing for the decoder to mistake a smudge for.
 */
export const SCAN_FORMATS = ['code_128', 'code_39', 'qr_code', 'data_matrix'] as const;

interface DetectedBarcode {
  rawValue: string;
}

interface Engine {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorLike {
  new (options?: { formats?: readonly string[] }): Engine;
  getSupportedFormats?: () => Promise<string[]>;
}

function detector(): BarcodeDetectorLike | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorLike }).BarcodeDetector;
}

/**
 * Whether this device can scan at all.
 *
 * Asked before a scan button is drawn rather than after it is pressed. A button
 * that opens the camera and then admits it cannot read anything is worse than
 * no button: the inspector has already put their phone somewhere awkward.
 */
export function scanningSupported(): boolean {
  return typeof detector() === 'function' && typeof navigator?.mediaDevices?.getUserMedia === 'function';
}

/** The one place that knows what does the decoding. */
export function findEngine(): Engine | null {
  const Detector = detector();
  if (!Detector) return null;
  try {
    return new Detector({ formats: SCAN_FORMATS });
  } catch {
    // Some builds reject an unsupported format outright rather than ignoring it.
    try {
      return new Detector();
    } catch {
      return null;
    }
  }
}

/**
 * Tidy a raw decode into something worth storing.
 *
 * Barcodes carry padding, and a wrapped label can decode with a newline in the
 * middle. Case is left exactly as it was read — serials are case-sensitive often
 * enough that helpfully upper-casing one is a way to break a warranty lookup.
 */
export function normaliseCode(raw: string): string {
  return (
    raw
      // Code 128 carries FNC1 and friends, which decode to unprintables. Left
      // in, they sit invisibly inside a serial where nobody can see them and
      // every comparison against the manufacturer's records quietly fails.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Add a scanned code to whatever the field already holds.
 *
 * Two things make this less obvious than appending a line.
 *
 * A scan loop fires many times a second and reads the same plate on each pass,
 * so the same code arrives over and over — without a check, one steady hand
 * produces forty copies of one serial. And a job legitimately has several: the
 * outdoor unit, each indoor head, each controller. So a repeat is dropped and a
 * genuinely new code is appended, and the inspector can still edit the field by
 * hand afterwards, because a rained-on label sometimes wins.
 */
export function mergeCodes(existing: string | undefined, scanned: string): string {
  const code = normaliseCode(scanned);
  if (!code) return existing ?? '';

  const lines = (existing ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.some((line) => line === code)) return lines.join('\n');
  return [...lines, code].join('\n');
}

/** How many codes a field holds, for telling somebody what they have so far. */
export function countCodes(value: string | undefined): number {
  return (value ?? '').split('\n').filter((line) => line.trim()).length;
}
