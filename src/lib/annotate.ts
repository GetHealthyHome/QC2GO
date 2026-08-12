/**
 * Marks drawn on a photo to point at what is wrong.
 *
 * A deficiency photo of a whole crawlspace with "rim joist left open at the
 * south wall" underneath asks the customer to find it themselves. An arrow
 * does not.
 *
 * Two decisions shape this file.
 *
 * **Annotations are stored beside the photo, never burned into it.** The
 * original evidence stays exactly as the camera produced it — an arrow drawn in
 * the wrong place can be moved, and nobody has to wonder whether the pixels
 * under it were altered. It also matches the TRD's payload, which models
 * `media_attachments[].annotations` as an array rather than a second image.
 *
 * **Coordinates are normalised to 0–1.** A mark drawn on a phone has to land in
 * the same place in a report on a laptop and again on A4 paper, and the only
 * number that survives all three is a fraction of the image.
 */

export type AnnotationKind = 'arrow' | 'box' | 'freehand' | 'text';

/** A point as a fraction of the image: {0,0} top-left, {1,1} bottom-right. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Three, not a palette. The colour is carrying meaning here — this is the
 * defect, this is the area, this is a note — and a dozen shades would say
 * nothing at all.
 */
export type AnnotationColor = 'red' | 'amber' | 'white';

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  color: AnnotationColor;
  /** Arrow and box: two points. Freehand: the whole stroke. Text: one anchor. */
  points: Point[];
  /** Text annotations only. */
  text?: string;
}

export const ANNOTATION_COLORS: Record<AnnotationColor, string> = {
  red: '#e5342a',
  amber: '#f79009',
  white: '#ffffff',
};

export const COLOR_LABELS: Record<AnnotationColor, string> = {
  red: 'Defect',
  amber: 'Attention',
  white: 'Note',
};

/**
 * Stroke width as a fraction of the image's smaller side, so a mark reads the
 * same on a 4:3 photo at thumbnail size and at full width on paper.
 */
export const STROKE_RATIO = 0.006;
export const TEXT_RATIO = 0.045;

export function clampPoint(point: Point): Point {
  return {
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(1, Math.max(0, point.y)),
  };
}

/** Perpendicular distance from a point to the line through `from` and `to`. */
function distanceToLine(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  return Math.abs(dy * point.x - dx * point.y + to.x * from.y - to.y * from.x) / length;
}

/**
 * Freehand strokes arrive at pointer-event resolution — hundreds of points for
 * a short line, most of them a fraction of a pixel apart and nearly all of them
 * on top of a line the two ends already describe. Dropping those keeps a
 * photo's annotations from being larger than the photo, which matters when they
 * sync over a phone connection.
 *
 * Ramer–Douglas–Peucker rather than plain distance thinning: what makes a point
 * worth keeping is that the stroke *turns* there, not that it moved. Spacing
 * alone throws away half the points of a straight line and keeps the other
 * half, all of which say the same nothing.
 */
export function simplify(points: Point[], tolerance = 0.004): Point[] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];

  let furthest = 0;
  let furthestAt = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = distanceToLine(points[i], first, last);
    if (distance > furthest) {
      furthest = distance;
      furthestAt = i;
    }
  }

  // Nothing strays far enough from the straight line between the ends for the
  // shape to be lost by replacing it with that line.
  if (furthest <= tolerance) return [first, last];

  return [
    ...simplify(points.slice(0, furthestAt + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(furthestAt), tolerance),
  ];
}

/** An SVG path for a freehand stroke, in the given pixel space. */
export function strokePath(points: Point[], width: number, height: number): string {
  if (points.length === 0) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x * width} ${point.y * height}`)
    .join(' ');
}

/** The two lines of an arrowhead, sized against the shaft rather than the image. */
export function arrowHead(from: Point, to: Point, width: number, height: number): string {
  const x1 = from.x * width;
  const y1 = from.y * height;
  const x2 = to.x * width;
  const y2 = to.y * height;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  // Proportional to the arrow's own length, with a floor so a short arrow still
  // has a head somebody can see.
  const length = Math.max(Math.hypot(x2 - x1, y2 - y1) * 0.28, Math.min(width, height) * 0.04);
  const spread = Math.PI / 7;
  const left = { x: x2 - length * Math.cos(angle - spread), y: y2 - length * Math.sin(angle - spread) };
  const right = { x: x2 - length * Math.cos(angle + spread), y: y2 - length * Math.sin(angle + spread) };
  return `M ${left.x} ${left.y} L ${x2} ${y2} L ${right.x} ${right.y}`;
}

/** Normalised rectangle from two corners, in either drag direction. */
export function rectOf(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Marks too small to be deliberate — a tap rather than a drag. */
export function isDegenerate(annotation: Annotation): boolean {
  if (annotation.kind === 'text') return !annotation.text?.trim();
  if (annotation.points.length < 2) return true;
  if (annotation.kind === 'freehand') return false;
  const [from, to] = annotation.points;
  return Math.hypot(to.x - from.x, to.y - from.y) < 0.02;
}

export function newAnnotationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `a_${Math.random().toString(36).slice(2)}`;
}
