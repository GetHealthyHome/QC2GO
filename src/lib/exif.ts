/**
 * Reading the handful of EXIF tags that matter for evidence.
 *
 * This exists because of a bug rather than a feature. Photos are downscaled
 * through a canvas before they reach storage, and canvas re-encoding **discards
 * EXIF entirely** — so a QC2GO photo carried *less* provenance than the raw file
 * the camera produced. The original capture time and any coordinates the camera
 * recorded were gone before anything had a chance to read them.
 *
 * So this runs first, on the untouched `File`, and what it finds is kept
 * alongside the photo as ordinary fields.
 *
 * Only three things are read: when the shutter actually fired, and where. A
 * general EXIF library would be several times the size of this file and would
 * parse a hundred tags nothing here will ever ask for.
 */

export interface PhotoExif {
  /** DateTimeOriginal, as an ISO string. When the shutter fired, not when the file was saved. */
  takenAt?: string;
  /** Decimal degrees, positive north and east. */
  gps?: { lat: number; lng: number };
}

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LNG_REF = 0x0003;
const TAG_GPS_LNG = 0x0004;

/** Bytes per component, indexed by EXIF type. 0 for types this does not read. */
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

interface Cursor {
  view: DataView;
  /** Offsets inside the TIFF block are relative to its own start, not the file. */
  tiffStart: number;
  littleEndian: boolean;
}

/**
 * Find the TIFF block inside a JPEG's APP1 segment.
 *
 * JPEG is a chain of segments: 0xFFD8 to start, then `FF <marker> <length>`.
 * APP1 (0xFFE1) holds EXIF, introduced by "Exif\0\0".
 */
function findTiffStart(view: DataView): number | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    // Start of scan: past here is compressed image data, not metadata.
    if (marker === 0xda) return null;

    const length = view.getUint16(offset + 2);
    if (length < 2) return null;

    if (marker === 0xe1 && offset + 4 + 6 <= view.byteLength) {
      const header = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7),
      );
      if (header === 'Exif') return offset + 10;
    }
    offset += 2 + length;
  }
  return null;
}

function readEntries(cursor: Cursor, ifdOffset: number): Map<number, { type: number; count: number; valueOffset: number }> {
  const { view, tiffStart, littleEndian } = cursor;
  const entries = new Map<number, { type: number; count: number; valueOffset: number }>();

  const base = tiffStart + ifdOffset;
  if (base + 2 > view.byteLength) return entries;

  const count = view.getUint16(base, littleEndian);
  for (let i = 0; i < count; i += 1) {
    const entry = base + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;

    const tag = view.getUint16(entry, littleEndian);
    const type = view.getUint16(entry + 2, littleEndian);
    const components = view.getUint32(entry + 4, littleEndian);
    const size = (TYPE_SIZES[type] ?? 0) * components;

    // Four bytes or fewer live in the entry itself; anything larger is a
    // pointer to somewhere else in the TIFF block.
    const valueOffset = size <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, littleEndian);
    entries.set(tag, { type, count: components, valueOffset });
  }
  return entries;
}

function readAscii(cursor: Cursor, entry: { count: number; valueOffset: number }): string {
  const { view } = cursor;
  let text = '';
  for (let i = 0; i < entry.count; i += 1) {
    if (entry.valueOffset + i >= view.byteLength) break;
    const code = view.getUint8(entry.valueOffset + i);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text;
}

/** EXIF rationals are a pair of 32-bit integers. */
function readRational(cursor: Cursor, offset: number): number {
  const { view, littleEndian } = cursor;
  if (offset + 8 > view.byteLength) return NaN;
  const numerator = view.getUint32(offset, littleEndian);
  const denominator = view.getUint32(offset + 4, littleEndian);
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Degrees, minutes and seconds as three rationals, into decimal degrees. */
function readCoordinate(cursor: Cursor, entry: { count: number; valueOffset: number }): number | null {
  if (entry.count < 3) return null;
  const degrees = readRational(cursor, entry.valueOffset);
  const minutes = readRational(cursor, entry.valueOffset + 8);
  const seconds = readRational(cursor, entry.valueOffset + 16);
  if ([degrees, minutes, seconds].some(Number.isNaN)) return null;
  return degrees + minutes / 60 + seconds / 3600;
}

/**
 * "2026:08:12 14:03:07" — EXIF's own format, with no timezone. Read as local
 * time, which is what the camera meant: the clock on the wall where the photo
 * was taken.
 */
function parseExifDate(value: string): string | undefined {
  const match = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match.map(Number) as unknown as number[];
  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Never throws. A photo with unreadable or absent metadata is an ordinary
 * photo, not an error — most of them are, once a phone has stripped it.
 */
export async function readExif(file: Blob): Promise<PhotoExif> {
  try {
    // The metadata lives at the front. Reading the first 128 KB rather than a
    // 12 MB frame keeps this off the critical path of taking a photo.
    const head = file.slice(0, 128 * 1024);
    const view = new DataView(await head.arrayBuffer());

    const tiffStart = findTiffStart(view);
    if (tiffStart === null || tiffStart + 8 > view.byteLength) return {};

    const byteOrder = view.getUint16(tiffStart);
    if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return {};
    const cursor: Cursor = { view, tiffStart, littleEndian: byteOrder === 0x4949 };

    if (view.getUint16(tiffStart + 2, cursor.littleEndian) !== 0x002a) return {};

    const ifd0 = readEntries(cursor, view.getUint32(tiffStart + 4, cursor.littleEndian));
    const result: PhotoExif = {};

    const exifPointer = ifd0.get(TAG_EXIF_IFD);
    if (exifPointer) {
      const exifIfd = readEntries(
        cursor,
        view.getUint32(exifPointer.valueOffset, cursor.littleEndian),
      );
      const taken = exifIfd.get(TAG_DATE_TIME_ORIGINAL);
      if (taken) result.takenAt = parseExifDate(readAscii(cursor, taken));
    }

    const gpsPointer = ifd0.get(TAG_GPS_IFD);
    if (gpsPointer) {
      const gpsIfd = readEntries(
        cursor,
        view.getUint32(gpsPointer.valueOffset, cursor.littleEndian),
      );
      const latEntry = gpsIfd.get(TAG_GPS_LAT);
      const lngEntry = gpsIfd.get(TAG_GPS_LNG);
      if (latEntry && lngEntry) {
        const lat = readCoordinate(cursor, latEntry);
        const lng = readCoordinate(cursor, lngEntry);
        if (lat !== null && lng !== null) {
          const latRef = gpsIfd.get(TAG_GPS_LAT_REF);
          const lngRef = gpsIfd.get(TAG_GPS_LNG_REF);
          // South and west are recorded as positive numbers with a reference
          // letter beside them. Missing the sign puts a job in the wrong
          // hemisphere, which is worse than having no coordinates at all.
          const south = latRef ? readAscii(cursor, latRef).toUpperCase().startsWith('S') : false;
          const west = lngRef ? readAscii(cursor, lngRef).toUpperCase().startsWith('W') : false;
          result.gps = { lat: south ? -lat : lat, lng: west ? -lng : lng };
        }
      }
    }

    return result;
  } catch {
    return {};
  }
}
