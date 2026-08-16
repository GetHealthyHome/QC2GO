import { readExif } from './exif';
import { cachedPosition, refreshPosition } from './geo';

const MAX_EDGE = 1600;
const QUALITY = 0.82;

export interface EvidenceContext {
  inspectionId: string;
  inspectorName?: string;
}

export interface PreparedPhoto {
  blob: Blob;
  /** When the shutter fired, from the file's own metadata. */
  takenAt?: string;
  gps?: { lat: number; lng: number };
  /** Where the coordinates came from — the camera, or this device at capture. */
  gpsSource?: 'exif' | 'device';
  /** False when the browser could not decode the image and the original was kept. */
  watermarked: boolean;
}

/**
 * Everything that happens to a photo between the camera and storage.
 *
 * The order matters and is the whole point of this function. Metadata is read
 * from the **untouched file first**, because the downscale below re-encodes
 * through a canvas and canvas re-encoding discards EXIF entirely. Reading it
 * afterwards — which is what happened before — finds nothing, and a QC2GO photo
 * carried less provenance than the raw file the camera produced.
 *
 * Then the frame is downscaled (phone cameras produce 4–12 MB and an inspection
 * routinely carries 30+ photos, all stored on-device), and the provenance is
 * burned into the pixels on the way past, so it survives being exported,
 * printed, screenshotted or pulled out of a report by somebody else.
 */
export async function prepareEvidencePhoto(
  file: File,
  context: EvidenceContext,
): Promise<PreparedPhoto> {
  // First, before anything re-encodes it.
  const exif = await readExif(file);

  let gps = exif.gps;
  let gpsSource: PreparedPhoto['gpsSource'] = exif.gps ? 'exif' : undefined;
  if (!gps) {
    // Most phones strip EXIF GPS unless location is switched on for the camera
    // itself. Where the device was recently is a fair answer to the same
    // question, and it is labelled as such rather than passed off as the
    // camera's own.
    //
    // Read from cache and never waited on: a fix can take fifteen seconds
    // indoors, and holding up a photo that long is worse than a photo with no
    // coordinates.
    const position = cachedPosition();
    if (position) {
      gps = { lat: position.lat, lng: position.lng };
      gpsSource = 'device';
    }
  }
  // Warm it for the next one. Nothing here waits on the result.
  refreshPosition();

  const capturedAt = exif.takenAt ?? new Date().toISOString();

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const paint = canvas.getContext('2d');
    if (!paint) {
      bitmap.close();
      return { blob: file, takenAt: exif.takenAt, gps, gpsSource, watermarked: false };
    }
    paint.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    drawWatermark(paint, width, height, {
      capturedAt,
      gps,
      gpsSource,
      inspectionId: context.inspectionId,
      inspectorName: context.inspectorName,
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    return {
      blob: blob ?? file,
      takenAt: exif.takenAt,
      gps,
      gpsSource,
      watermarked: blob !== null,
    };
  } catch {
    // An undecodable image is still evidence. Keep the original rather than
    // losing the photo over a failed downscale.
    return { blob: file, takenAt: exif.takenAt, gps, gpsSource, watermarked: false };
  }
}

interface WatermarkFacts {
  capturedAt: string;
  gps?: { lat: number; lng: number };
  gpsSource?: 'exif' | 'device';
  inspectionId: string;
  inspectorName?: string;
}

/**
 * Burns the provenance into the bottom of the frame.
 *
 * Pixels rather than metadata, because metadata does not survive being exported
 * to a PDF, printed, screenshotted, or pulled out of a report and emailed on —
 * which is most of the ways one of these photos is ever looked at.
 *
 * Sized against the frame so it reads the same on a 4K photo and a small one.
 */
function drawWatermark(
  paint: CanvasRenderingContext2D,
  width: number,
  height: number,
  facts: WatermarkFacts,
): void {
  const lines = [
    formatStamp(facts.capturedAt),
    facts.gps
      ? `${facts.gps.lat.toFixed(5)}, ${facts.gps.lng.toFixed(5)}${facts.gpsSource === 'device' ? ' (device)' : ''}`
      : 'No location recorded',
    [facts.inspectorName, facts.inspectionId].filter(Boolean).join(' · '),
  ].filter(Boolean);

  const fontSize = Math.max(11, Math.round(width * 0.022));
  const padding = Math.round(fontSize * 0.6);
  const lineHeight = Math.round(fontSize * 1.35);
  const barHeight = lineHeight * lines.length + padding * 2;

  paint.save();
  paint.fillStyle = 'rgba(0, 0, 0, 0.55)';
  paint.fillRect(0, height - barHeight, width, barHeight);

  paint.fillStyle = '#ffffff';
  paint.font = `${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  paint.textBaseline = 'top';
  lines.forEach((line, index) => {
    paint.fillText(line, padding, height - barHeight + padding + index * lineHeight, width - padding * 2);
  });
  paint.restore();
}

/** UTC, stated as UTC. A timestamp with no zone is not evidence of anything. */
function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}
