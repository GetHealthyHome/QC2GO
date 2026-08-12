/**
 * Where the pieces of a report land on a page.
 *
 * Until now the customer deliverable was the browser's print dialog, which is
 * the one part of the report nobody controls: pagination differs between
 * Chrome, Safari and a phone, a checkpoint can be sliced in half by a page
 * break, and what a customer receives depends on which button they happened to
 * press. This module decides it instead.
 *
 * ## Why the layout is separate from the drawing
 *
 * Drawing needs a PDF library and real font metrics; deciding does not. Split
 * that way, the part that can quietly go wrong — content falling off a page,
 * a heading stranded at the bottom, a run that never terminates — is a pure
 * function over numbers, and is tested. `render.ts` holds everything that
 * touches pdf-lib and is deliberately dull.
 *
 * ## The invariant that matters
 *
 * Every block handed in comes out again, exactly once, whole. A PDF with an
 * ugly page break is a cosmetic problem; a PDF quietly missing the checkpoint
 * that failed is a different kind of problem entirely, and it is the one that
 * would never be noticed until somebody needed that page. `paginate` is
 * written so that dropping content is not an available outcome — when a block
 * cannot be made to fit, it overflows visibly rather than disappearing.
 */

/** A unit of content that has already been measured. */
export interface Block {
  /** Identifies the block in the output. Unique within one document. */
  key: string;
  /** Full height in points. For a splittable block, `unitHeight * units`. */
  height: number;
  /**
   * This block must not be the last thing on a page — a section heading with
   * its first row on the following page reads as an empty section.
   */
  keepWithNext?: boolean;
  /**
   * A block that may break across pages, at fixed-height boundaries. Body text
   * is the case: it is a stack of identical lines and there is no reason to
   * push a whole paragraph to the next page to keep it together.
   */
  split?: {
    unitHeight: number;
    units: number;
    /**
     * Never leave fewer than this many units alone on either side of a break.
     * One line of a paragraph stranded by itself is a widow, and it looks like
     * a mistake rather than a paragraph.
     */
    minUnits: number;
  };
}

export interface Placed {
  key: string;
  /** Distance from the top of the page's content area, in points. */
  y: number;
  height: number;
  /**
   * Present only when a splittable block was broken. `index` is 0-based and
   * `total` is how many pieces the block ended up in, so a renderer knows
   * which slice of the content this piece holds.
   */
  part?: { index: number; total: number; unitStart: number; units: number };
}

export interface Page {
  /** 1-based, as printed. */
  number: number;
  blocks: Placed[];
}

export interface PageMetrics {
  /** Height of the content area, in points — the page minus its margins. */
  height: number;
  /**
   * Content lost at the top of page one to the letterhead. Every other page
   * starts at zero.
   */
  firstPageOffset?: number;
  /** Vertical space left between blocks. */
  gap?: number;
}

/**
 * The least a block can bring with it — used to decide whether a
 * `keepWithNext` block has enough company to stay where it is. A splittable
 * follower only has to bring its minimum number of units along.
 */
function leadHeight(next: Block | undefined): number {
  if (!next) return 0;
  if (next.split) return next.split.minUnits * next.split.unitHeight;
  return next.height;
}

export function paginate(blocks: Block[], metrics: PageMetrics): Page[] {
  const limit = metrics.height;
  const gap = metrics.gap ?? 0;

  const pages: Page[] = [];
  let current: Placed[] = [];
  let y = metrics.firstPageOffset ?? 0;

  function flush() {
    pages.push({ number: pages.length + 1, blocks: current });
    current = [];
    y = 0;
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    if (block.split) {
      const { unitHeight, units, minUnits } = block.split;
      const pieces: Placed[] = [];
      let done = 0;

      while (done < units) {
        const remaining = limit - y;
        const left = units - done;
        let take = Math.min(left, Math.floor(remaining / unitHeight));

        // Refuse a break that would strand a widow on either side of it.
        if (take < left && (take < minUnits || left - take < minUnits)) take = 0;

        if (take === 0) {
          // On an empty page there is nowhere better to go, so it overflows
          // rather than looping forever asking for a page that never comes.
          if (current.length === 0) {
            take = left;
          } else {
            flush();
            continue;
          }
        }

        const placed: Placed = {
          key: block.key,
          y,
          height: take * unitHeight,
          part: { index: pieces.length, total: 0, unitStart: done, units: take },
        };
        pieces.push(placed);
        current.push(placed);
        y += placed.height + gap;
        done += take;
        if (done < units) flush();
      }

      // `total` is only knowable once the block has finished breaking.
      for (const piece of pieces) piece.part!.total = pieces.length;
      continue;
    }

    const lead = block.keepWithNext ? leadHeight(blocks[index + 1]) : 0;
    // An empty page always accepts the block: a block taller than a whole page
    // has to go somewhere, and overflowing one is recoverable in a way that
    // silently dropping it is not.
    if (current.length > 0 && block.height + lead > limit - y) flush();

    current.push({ key: block.key, y, height: block.height });
    y += block.height + gap;
  }

  if (current.length > 0 || pages.length === 0) flush();
  return pages;
}

/**
 * Everything the PDF's standard fonts can actually draw.
 *
 * The built-in fonts are WinAnsi-encoded, and pdf-lib does not draw a missing
 * glyph as a box — it throws. So a customer who pastes an emoji into a note, or
 * a Cyrillic surname, or the invisible byte a barcode scanner sometimes emits,
 * would not get an ugly report: they would get no report, from a button that
 * simply appears broken.
 *
 * Replacing the character is the lesser loss, and it is confined to display —
 * the record itself is untouched.
 */
const ENCODABLE =
  /[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u201a\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192]/g;

export function encodable(text: string): string {
  // Newlines survive: `wrapText` reads them, and they are stripped per line
  // before anything is drawn.
  return text
    .split('\n')
    .map((line) => line.replace(ENCODABLE, '?'))
    .join('\n');
}

/**
 * Break a string into lines that fit a column.
 *
 * `widthOf` is injected rather than imported so this can be exercised without a
 * font: the caller in `render.ts` passes pdf-lib's metrics, and the checks pass
 * a fixed width per character.
 *
 * Existing newlines are kept — an inspector's note is written in paragraphs and
 * reflowing it into one block loses what they meant by the break.
 *
 * The case worth naming: a single token longer than the column. A model or
 * serial number is exactly that, it arrives unbroken by design, and a
 * word-wrapper with no answer for it emits one over-long line that runs off the
 * edge of the page. Since the whole point of a serial on a report is that
 * somebody retypes it into a warranty registration, the half that runs past the
 * margin is the half that costs money. It is hard-split instead.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  widthOf: (value: string) => number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ').filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      if (widthOf(word) <= maxWidth) {
        line = word;
        continue;
      }
      // Longer than the column on its own: cut it where it stops fitting.
      let rest = word;
      while (widthOf(rest) > maxWidth) {
        let cut = 1;
        while (cut < rest.length && widthOf(rest.slice(0, cut + 1)) <= maxWidth) cut += 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
  }

  return lines;
}
