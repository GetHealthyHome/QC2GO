/**
 * The company logo, and the fixed area it lives in.
 *
 * The slot is a predefined box, reserved whether or not a logo has been
 * uploaded. That is the point of it: a report laid out with the placeholder is
 * laid out identically once the real logo arrives, so nothing reflows and no
 * page break moves. A company can put its mark on the document without anyone
 * re-checking how the document sits on the page.
 *
 * Everything below is expressed against `LOGO_SLOT`, so the proportion is
 * stated once and the report, the settings preview and the downscaler cannot
 * drift apart.
 */

/**
 * 3:1, which is the shape most company wordmarks already are. A logo of any
 * other proportion is fitted inside it rather than cropped or stretched —
 * `object-fit: contain` on screen, and the same maths in the downscaler — so a
 * square badge or a tall crest still lands intact, just narrower.
 */
export const LOGO_SLOT = {
  width: 216,
  height: 72,
} as const;

/**
 * Stored at three times the on-screen slot. A report is printed as often as it
 * is read, and a 216px-wide image on paper is a blurry one — 648px across the
 * same physical space is around 300 dpi at the size the slot occupies.
 */
const STORED_SCALE = 3;

/** Matches the check constraint on `organizations.logo`. */
export const MAX_LOGO_BYTES = 512 * 1024;

/**
 * Fit a source image inside the slot without distorting it: scale to whichever
 * axis runs out first, and leave the rest as transparent margin.
 */
function fitted(width: number, height: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(boxWidth / width, boxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Turn an uploaded file into a data URL sized for the slot.
 *
 * PNG rather than JPEG: logos are flat colour and very often transparent, and
 * JPEG would both muddy the edges and replace transparency with a white
 * rectangle that only becomes visible once the report is printed on something
 * other than white.
 *
 * If the result is still over the ceiling — a photographic logo, or one saved
 * with an enormous palette — it is re-encoded smaller rather than rejected.
 * Being told "your logo is 40 KB too large" is not something anybody can act on.
 */
export async function prepareLogo(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);

  try {
    for (let scale = STORED_SCALE; scale >= 1; scale -= 0.5) {
      const box = fitted(
        bitmap.width,
        bitmap.height,
        LOGO_SLOT.width * scale,
        LOGO_SLOT.height * scale,
      );

      const canvas = document.createElement('canvas');
      canvas.width = box.width;
      canvas.height = box.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot process images.');
      context.drawImage(bitmap, 0, 0, box.width, box.height);

      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl.length <= MAX_LOGO_BYTES) return dataUrl;
    }
  } finally {
    bitmap.close();
  }

  throw new Error(
    'That image is too detailed to use as a logo. A PNG or SVG of the wordmark itself, ' +
      'rather than a photograph of it, will be a fraction of the size.',
  );
}

/**
 * What to head the report with. The organization's name once accounts are
 * connected; the device's own setting when they are not, because a local-only
 * install still prints reports and still belongs to somebody.
 */
export function letterheadName(
  organizationName: string | undefined,
  localCompanyName: string,
): string {
  return organizationName?.trim() || localCompanyName.trim() || 'QC2GO';
}
