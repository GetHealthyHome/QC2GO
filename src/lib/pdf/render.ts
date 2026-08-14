/**
 * Ink on the page.
 *
 * Everything that needs pdf-lib or a real font lives here, and it is
 * deliberately dull: measure each element, hand the heights to `paginate`, draw
 * what comes back. The decisions worth arguing about are in `layout.ts`, where
 * they can be tested without a PDF.
 *
 * ## Why this runs on the device rather than on a server
 *
 * The roadmap called for server-side rendering. It is written here instead, for
 * the reason the rest of the app is written the way it is: an inspector in a
 * crawlspace has no signal, and a deliverable that needs a round trip is a
 * deliverable they cannot hand over while standing in the building. Generating
 * it locally also means the feature works the day it ships rather than the day
 * the functions are deployed.
 *
 * What a server would have added over this is consistent pagination and a real
 * file instead of the browser's print dialog — and both of those are what this
 * module does. pdf-lib is pulled in through a dynamic import, so the ~350 KB it
 * costs is only fetched by somebody who actually asks for a PDF, and is then
 * cached by the service worker like every other build asset.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import {
  ANNOTATION_COLORS,
  STROKE_RATIO,
  TEXT_RATIO,
  arrowHead,
  rectOf,
  strokePath,
  type Annotation,
} from '../annotate';
import { encodable, paginate, wrapText, type Block } from './layout';
import type { Element, ReportDocument } from './content';

// US Letter, in points.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 46;
const MARGIN_TOP = 46;
const MARGIN_BOTTOM = 52;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;

const LETTERHEAD_H = 62;
const BLOCK_GAP = 7;
const INDENT = 17;

/**
 * Longest side of an embedded photo, in pixels. A photo is drawn about 1.6
 * inches wide, so this is still far more resolution than the page can show —
 * the point is that a report with sixty photos in it stays a file somebody can
 * open and email, rather than one their phone runs out of memory building.
 */
const PHOTO_MAX_PX = 700;
const PHOTO_QUALITY = 0.72;

const COLORS = {
  ink900: hex('#121820'),
  ink800: hex('#212a35'),
  ink700: hex('#37424f'),
  ink600: hex('#4a5768'),
  ink500: hex('#64748b'),
  ink400: hex('#8895a5'),
  ink300: hex('#b9c3ce'),
  ink200: hex('#dbe1e8'),
  ink100: hex('#eceff3'),
  ink50: hex('#f6f8fa'),
  // The brand blue, matching --color-brand-600 in index.css. The report a
  // customer receives is the one place the colour has to be right on paper as
  // well as on screen, so this is the palette's own #156082 rather than near it.
  brand600: hex('#156082'),
  pass500: hex('#12b76a'),
  pass700: hex('#027a48'),
  fail500: hex('#f04438'),
  fail50: hex('#fef3f2'),
  fail700: hex('#b42318'),
  warn500: hex('#f79009'),
  warn600: hex('#dc6803'),
  white: rgb(1, 1, 1),
};

function hex(value: string) {
  const n = parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

/** Draws into one page, with y measured downward from the content area's top. */
class Painter {
  constructor(
    readonly page: PDFPage,
    readonly fonts: Fonts,
  ) {}

  private abs(top: number): number {
    return PAGE_H - MARGIN_TOP - top;
  }

  text(
    value: string,
    x: number,
    top: number,
    options: { size: number; font?: PDFFont; color?: ReturnType<typeof rgb> },
  ) {
    const font = options.font ?? this.fonts.regular;
    this.page.drawText(encodable(value).replace(/\n/g, ' '), {
      x: MARGIN_X + x,
      // `top` is the top of the line box; pdf-lib wants a baseline.
      y: this.abs(top + options.size),
      size: options.size,
      font,
      color: options.color ?? COLORS.ink900,
    });
  }

  /** Right-aligned against the content edge, for values and page numbers. */
  textRight(
    value: string,
    right: number,
    top: number,
    options: { size: number; font?: PDFFont; color?: ReturnType<typeof rgb> },
  ) {
    const font = options.font ?? this.fonts.regular;
    const clean = encodable(value).replace(/\n/g, ' ');
    this.text(clean, right - font.widthOfTextAtSize(clean, options.size), top, options);
  }

  rect(
    x: number,
    top: number,
    width: number,
    height: number,
    options: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb>; borderWidth?: number },
  ) {
    this.page.drawRectangle({
      x: MARGIN_X + x,
      y: this.abs(top + height),
      width,
      height,
      color: options.fill,
      borderColor: options.border,
      borderWidth: options.border ? (options.borderWidth ?? 0.7) : undefined,
    });
  }

  line(x1: number, top1: number, x2: number, top2: number, color: ReturnType<typeof rgb>, thickness = 1) {
    this.page.drawLine({
      start: { x: MARGIN_X + x1, y: this.abs(top1) },
      end: { x: MARGIN_X + x2, y: this.abs(top2) },
      color,
      thickness,
    });
  }

  circle(cx: number, top: number, radius: number, options: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb> }) {
    this.page.drawCircle({
      x: MARGIN_X + cx,
      y: this.abs(top),
      size: radius,
      color: options.fill,
      borderColor: options.border,
      borderWidth: options.border ? 1.2 : undefined,
    });
  }

  image(image: PDFImage, x: number, top: number, width: number, height: number) {
    this.page.drawImage(image, { x: MARGIN_X + x, y: this.abs(top + height), width, height });
  }
}

/** An element that has been measured and knows how to draw itself. */
interface Item {
  block: Block;
  draw(painter: Painter, top: number, part?: { unitStart: number; units: number }): void;
}

const LINE = 1.32;

function lineHeight(size: number): number {
  return Math.round(size * LINE * 100) / 100;
}

export interface PhotoSource {
  blob?: Blob;
  annotations?: Annotation[];
}

/**
 * Flatten a photo and its marks into one raster.
 *
 * The marks are drawn with the same `strokePath` and `arrowHead` the screen
 * uses, rather than a second implementation of the same geometry — an arrow
 * that points at one thing on a phone and something else on paper is exactly
 * the failure that would discredit an annotated photo in front of a customer.
 */
async function flattenPhoto(source: PhotoSource): Promise<Uint8Array | null> {
  if (!source.blob) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source.blob);
  } catch {
    return null;
  }

  const scale = Math.min(1, PHOTO_MAX_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  for (const annotation of source.annotations ?? []) {
    drawAnnotation(ctx, annotation, width, height);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY),
  );
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: Annotation,
  width: number,
  height: number,
) {
  const color = ANNOTATION_COLORS[annotation.color];
  const stroke = Math.min(width, height) * STROKE_RATIO;
  // The same dark halo the screen draws: red on a dark crawlspace photo and
  // white on a bright wall are both invisible without one.
  const halo = stroke * 2.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const strokeTwice = (path: Path2D) => {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = halo;
    ctx.stroke(path);
    ctx.strokeStyle = color;
    ctx.lineWidth = stroke;
    ctx.stroke(path);
  };

  if (annotation.kind === 'freehand') {
    strokeTwice(new Path2D(strokePath(annotation.points, width, height)));
    return;
  }

  if (annotation.kind === 'arrow') {
    const [from, to] = annotation.points;
    if (!from || !to) return;
    const shaft = new Path2D();
    shaft.moveTo(from.x * width, from.y * height);
    shaft.lineTo(to.x * width, to.y * height);
    strokeTwice(shaft);
    strokeTwice(new Path2D(arrowHead(from, to, width, height)));
    return;
  }

  if (annotation.kind === 'box') {
    const [corner, opposite] = annotation.points;
    if (!corner || !opposite) return;
    const rect = rectOf(corner, opposite);
    const path = new Path2D();
    path.rect(rect.x * width, rect.y * height, rect.width * width, rect.height * height);
    strokeTwice(path);
    return;
  }

  const anchor = annotation.points[0];
  if (!anchor || !annotation.text) return;
  const size = Math.min(width, height) * TEXT_RATIO;
  ctx.font = `700 ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.lineWidth = size * 0.14;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(annotation.text, anchor.x * width, anchor.y * height);
  ctx.fillStyle = color;
  ctx.fillText(annotation.text, anchor.x * width, anchor.y * height);
}

export async function generateReportPdf(input: {
  document: ReportDocument;
  getPhoto: (id: string) => Promise<PhotoSource | undefined>;
}): Promise<Blob> {
  const { document: doc } = input;
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };

  const images = new Map<string, PDFImage>();
  const ids = new Set(
    doc.elements.flatMap((element) => (element.kind === 'checkpoint' ? element.photoIds : [])),
  );
  for (const id of ids) {
    const bytes = await flattenPhoto((await input.getPhoto(id)) ?? {});
    // A photo that will not decode is left out rather than aborting the file —
    // the report is still the record of the job, and the checkpoint's answer
    // and note are the part somebody is relying on.
    if (bytes) images.set(id, await pdf.embedJpg(bytes));
  }

  const signatures = new Map<string, PDFImage>();
  for (const element of doc.elements) {
    if (element.kind !== 'signatures') continue;
    for (const entry of element.blocks) {
      if (!entry.dataUrl) continue;
      try {
        signatures.set(entry.label, await pdf.embedPng(entry.dataUrl));
      } catch {
        /* A signature that will not decode simply does not appear. */
      }
    }
  }

  const logo = await embedLogo(pdf, doc.header.logo);

  const items = doc.elements.map((element, index) =>
    measure(element, `e${index}`, fonts, images, signatures),
  );

  const pages = paginate(
    items.map((item) => item.block),
    { height: CONTENT_H, firstPageOffset: LETTERHEAD_H, gap: BLOCK_GAP },
  );
  const byKey = new Map(items.map((item) => [item.block.key, item]));

  pages.forEach((layoutPage, index) => {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const painter = new Painter(page, fonts);
    if (index === 0) drawLetterhead(painter, doc, logo);
    drawFooter(painter, doc.footer, layoutPage.number, pages.length);
    for (const placed of layoutPage.blocks) {
      byKey.get(placed.key)?.draw(painter, placed.y, placed.part);
    }
  });

  // `slice()` gives the bytes a buffer of their own, which is what Blob wants.
  const bytes = (await pdf.save()).slice();
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

async function embedLogo(pdf: PDFDocument, dataUrl?: string): Promise<PDFImage | null> {
  if (!dataUrl?.startsWith('data:image/')) return null;
  try {
    return dataUrl.includes('image/png')
      ? await pdf.embedPng(dataUrl)
      : await pdf.embedJpg(dataUrl);
  } catch {
    return null;
  }
}

function drawLetterhead(painter: Painter, doc: ReportDocument, logo: PDFImage | null) {
  let x = 0;
  if (logo) {
    const height = 26;
    const width = Math.min(120, (logo.width / logo.height) * height);
    painter.image(logo, 0, 0, width, height);
    x = width + 10;
  }
  painter.text(doc.header.companyName, x, 2, { size: 13, font: painter.fonts.bold });
  painter.text(doc.header.title, x, 19, { size: 9.5, color: COLORS.ink600 });
  if (doc.header.meta) {
    painter.text(doc.header.meta, x, 32, { size: 8.5, color: COLORS.ink500 });
  }
  painter.line(0, LETTERHEAD_H - 12, CONTENT_W, LETTERHEAD_H - 12, COLORS.brand600, 1.6);
}

function drawFooter(painter: Painter, footer: string, number: number, total: number) {
  const top = CONTENT_H + 22;
  painter.line(0, top - 10, CONTENT_W, top - 10, COLORS.ink200, 0.7);
  painter.text(footer, 0, top, { size: 7.5, color: COLORS.ink400 });
  painter.textRight(`Page ${number} of ${total}`, CONTENT_W, top, {
    size: 7.5,
    color: COLORS.ink400,
  });
}

function measure(
  element: Element,
  key: string,
  fonts: Fonts,
  images: Map<string, PDFImage>,
  signatures: Map<string, PDFImage>,
): Item {
  const widthOf = (font: PDFFont, size: number) => (value: string) =>
    font.widthOfTextAtSize(value, size);

  switch (element.kind) {
    case 'heading': {
      const height = 15;
      return {
        block: { key, height, keepWithNext: true },
        draw(painter, top) {
          painter.text(element.text.toUpperCase(), 0, top + 3, {
            size: 8.5,
            font: fonts.bold,
            color: COLORS.ink500,
          });
          if (element.meta) {
            painter.textRight(element.meta, CONTENT_W, top + 3, {
              size: 8.5,
              font: fonts.bold,
              color:
                element.tone === 'fail'
                  ? COLORS.fail700
                  : element.tone === 'warn'
                    ? COLORS.warn600
                    : element.tone === 'pass'
                      ? COLORS.pass700
                      : COLORS.ink500,
            });
          }
          painter.line(0, top + 14, CONTENT_W, top + 14, COLORS.ink200, 0.7);
        },
      };
    }

    case 'stats': {
      const height = 58;
      return {
        block: { key, height },
        draw(painter, top) {
          const gap = 8;
          const width = (CONTENT_W - gap * 3) / 4;
          element.items.forEach((item, index) => {
            const x = index * (width + gap);
            painter.rect(x, top, width, 40, { fill: COLORS.ink50 });
            const color =
              item.tone === 'pass'
                ? COLORS.pass700
                : item.tone === 'fail'
                  ? COLORS.fail700
                  : item.tone === 'warn'
                    ? COLORS.warn600
                    : COLORS.ink500;
            const label = String(item.value);
            const size = 16;
            painter.text(
              label,
              x + (width - fonts.bold.widthOfTextAtSize(label, size)) / 2,
              top + 6,
              { size, font: fonts.bold, color },
            );
            const small = 7.5;
            painter.text(
              item.label.toUpperCase(),
              x + (width - fonts.bold.widthOfTextAtSize(item.label.toUpperCase(), small)) / 2,
              top + 27,
              { size: small, font: fonts.bold, color: COLORS.ink500 },
            );
          });
          painter.text(element.footnote, 0, top + 46, { size: 8, color: COLORS.ink500 });
        },
      };
    }

    case 'fields': {
      const columnWidth = (CONTENT_W - 16) / 2;
      const wrapped = element.items.map((item) => ({
        label: item.label.toUpperCase(),
        lines: wrapText(encodable(item.value), columnWidth, widthOf(fonts.bold, 9.5)),
      }));
      const rows: number[] = [];
      for (let index = 0; index < wrapped.length; index += 2) {
        const left = wrapped[index];
        const right = wrapped[index + 1];
        rows.push(
          12 + Math.max(left.lines.length, right?.lines.length ?? 0) * lineHeight(9.5) + 5,
        );
      }
      const height = rows.reduce((sum, row) => sum + row, 0);
      return {
        block: { key, height },
        draw(painter, top) {
          let y = top;
          wrapped.forEach((item, index) => {
            const column = index % 2;
            const x = column * (columnWidth + 16);
            painter.text(item.label, x, y, { size: 7, font: fonts.bold, color: COLORS.ink400 });
            item.lines.forEach((line, lineIndex) => {
              painter.text(line, x, y + 10 + lineIndex * lineHeight(9.5), {
                size: 9.5,
                font: fonts.bold,
              });
            });
            if (column === 1 || index === wrapped.length - 1) {
              y += rows[Math.floor(index / 2)];
            }
          });
        },
      };
    }

    case 'paragraph': {
      const size = 9.5;
      const lines = wrapText(encodable(element.text), CONTENT_W, widthOf(fonts.regular, size));
      const unit = lineHeight(size);
      return {
        block: {
          key,
          height: lines.length * unit,
          split: { unitHeight: unit, units: lines.length, minUnits: Math.min(2, lines.length) },
        },
        draw(painter, top, part) {
          const start = part?.unitStart ?? 0;
          const count = part?.units ?? lines.length;
          lines.slice(start, start + count).forEach((line, index) => {
            painter.text(line, 0, top + index * unit, { size, color: COLORS.ink700 });
          });
        },
      };
    }

    case 'measurement': {
      const size = 9.5;
      const valueWidth = fonts.bold.widthOfTextAtSize(element.value, size) + 12;
      const lines = wrapText(
        encodable(element.text),
        CONTENT_W - valueWidth,
        widthOf(fonts.regular, size),
      );
      const height = lines.length * lineHeight(size) + 6;
      return {
        block: { key, height },
        draw(painter, top) {
          lines.forEach((line, index) => {
            painter.text(line, 0, top + index * lineHeight(size), {
              size,
              color: COLORS.ink700,
            });
          });
          painter.textRight(element.value, CONTENT_W, top, { size, font: fonts.bold });
          painter.line(0, top + height - 3, CONTENT_W, top + height - 3, COLORS.ink100, 0.6);
        },
      };
    }

    case 'row': {
      const size = 9.5;
      const lines = wrapText(encodable(element.text), CONTENT_W, widthOf(fonts.regular, size));
      const subLines = element.sub
        ? wrapText(encodable(element.sub), CONTENT_W, widthOf(fonts.regular, 8))
        : [];
      const height = lines.length * lineHeight(size) + subLines.length * lineHeight(8) + 6;
      return {
        block: { key, height },
        draw(painter, top) {
          let y = top;
          lines.forEach((line) => {
            painter.text(line, 0, y, { size, color: COLORS.ink700 });
            y += lineHeight(size);
          });
          subLines.forEach((line) => {
            painter.text(line, 0, y, { size: 8, color: COLORS.ink500 });
            y += lineHeight(8);
          });
          painter.line(0, top + height - 3, CONTENT_W, top + height - 3, COLORS.ink100, 0.6);
        },
      };
    }

    case 'checkpoint': {
      const size = 9.5;
      const textWidth = CONTENT_W - INDENT;
      const lines = wrapText(encodable(element.text), textWidth, widthOf(fonts.regular, size));
      const serialLines = element.serial
        ? wrapText(encodable(element.serial), textWidth - 12, widthOf(fonts.mono, 9))
        : [];
      const noteLines = element.note
        ? wrapText(encodable(element.note), textWidth - 12, widthOf(fonts.regular, 8.5))
        : [];

      const photos = element.photoIds.filter((id) => images.has(id));
      const perRow = 3;
      const photoGap = 6;
      const cellW = (textWidth - photoGap * (perRow - 1)) / perRow;
      const cellH = cellW * 0.75;
      const photoRows = Math.ceil(photos.length / perRow);

      const textH = lines.length * lineHeight(size);
      const serialH = serialLines.length ? serialLines.length * lineHeight(9) + 10 + 4 : 0;
      const noteH = noteLines.length ? noteLines.length * lineHeight(8.5) + 10 + 4 : 0;
      const photoH = photoRows ? photoRows * (cellH + photoGap) + 2 : 0;
      const height = Math.max(textH, 13) + serialH + noteH + photoH + 5;

      return {
        block: { key, height },
        draw(painter, top) {
          drawMark(painter, element.mark, top + 4.5);
          lines.forEach((line, index) => {
            painter.text(line, INDENT, top + index * lineHeight(size), {
              size,
              color: COLORS.ink900,
            });
          });

          let y = top + Math.max(textH, 13) + 2;

          if (serialLines.length) {
            const boxH = serialLines.length * lineHeight(9) + 10;
            painter.rect(INDENT, y, textWidth, boxH, { fill: COLORS.ink50 });
            serialLines.forEach((line, index) => {
              painter.text(line, INDENT + 6, y + 5 + index * lineHeight(9), {
                size: 9,
                font: fonts.mono,
                color: COLORS.ink800,
              });
            });
            y += boxH + 4;
          }

          if (noteLines.length) {
            const boxH = noteLines.length * lineHeight(8.5) + 10;
            painter.rect(INDENT, y, textWidth, boxH, {
              fill: element.failed ? COLORS.fail50 : COLORS.ink50,
            });
            noteLines.forEach((line, index) => {
              painter.text(line, INDENT + 6, y + 5 + index * lineHeight(8.5), {
                size: 8.5,
                color: element.failed ? COLORS.fail700 : COLORS.ink600,
              });
            });
            y += boxH + 4;
          }

          photos.forEach((id, index) => {
            const image = images.get(id)!;
            const column = index % perRow;
            const row = Math.floor(index / perRow);
            const x = INDENT + column * (cellW + photoGap);
            const cellTop = y + row * (cellH + photoGap);
            painter.rect(x, cellTop, cellW, cellH, { fill: COLORS.ink100 });
            // Contained, never cropped: the defect is not reliably in the
            // middle of the frame, and a crop could remove the thing the photo
            // was taken to show.
            const scale = Math.min(cellW / image.width, cellH / image.height);
            const width = image.width * scale;
            const height = image.height * scale;
            painter.image(
              image,
              x + (cellW - width) / 2,
              cellTop + (cellH - height) / 2,
              width,
              height,
            );
          });
        },
      };
    }

    case 'signatures': {
      const height = 92;
      return {
        block: { key, height },
        draw(painter, top) {
          const gap = 20;
          const width = (CONTENT_W - gap) / 2;
          element.blocks.forEach((entry, index) => {
            const x = index * (width + gap);
            painter.text(entry.label.toUpperCase(), x, top, {
              size: 7,
              font: fonts.bold,
              color: COLORS.ink400,
            });
            const image = signatures.get(entry.label);
            if (image) {
              const boxH = 44;
              const scale = Math.min(width / image.width, boxH / image.height);
              painter.image(
                image,
                x,
                top + 12 + (boxH - image.height * scale),
                image.width * scale,
                image.height * scale,
              );
            }
            painter.line(x, top + 58, x + width, top + 58, COLORS.ink300, 0.9);
            if (entry.name) {
              painter.text(entry.name, x, top + 62, { size: 9.5, font: fonts.bold });
              if (entry.signedAt) {
                painter.text(entry.signedAt, x, top + 76, { size: 7.5, color: COLORS.ink500 });
              }
            } else {
              painter.text('Not signed', x, top + 62, { size: 8.5, color: COLORS.ink400 });
            }
          });
        },
      };
    }
  }
}

/**
 * `muted` is why this is not simply a tick or a cross. A red cross beside
 * "Gas-fired appliance on site — No" reads as a failed inspection to anybody
 * skimming, when what it says is that there is no gas appliance.
 */
function drawMark(painter: Painter, mark: { answer: string | null; muted?: boolean }, top: number) {
  const cx = 5;
  const r = 5;
  if (!mark.answer) {
    painter.circle(cx, top, r, { border: COLORS.warn500 });
    return;
  }
  const fill = mark.muted
    ? COLORS.ink300
    : mark.answer === 'yes'
      ? COLORS.pass500
      : mark.answer === 'no'
        ? COLORS.fail500
        : COLORS.ink400;
  painter.circle(cx, top, r, { fill });

  if (mark.answer === 'yes') {
    painter.line(cx - 2.4, top + 0.2, cx - 0.7, top + 2, COLORS.white, 1.3);
    painter.line(cx - 0.7, top + 2, cx + 2.5, top - 2, COLORS.white, 1.3);
    return;
  }
  if (mark.answer === 'no') {
    painter.line(cx - 2, top - 2, cx + 2, top + 2, COLORS.white, 1.3);
    painter.line(cx + 2, top - 2, cx - 2, top + 2, COLORS.white, 1.3);
    return;
  }
  painter.line(cx - 2.2, top, cx + 2.2, top, COLORS.white, 1.3);
}
