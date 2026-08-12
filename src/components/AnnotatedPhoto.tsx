import {
  ANNOTATION_COLORS,
  STROKE_RATIO,
  TEXT_RATIO,
  arrowHead,
  rectOf,
  strokePath,
  type Annotation,
} from '../lib/annotate';

/**
 * A photo with its marks drawn over it.
 *
 * SVG rather than a second canvas, and one component rather than one per
 * surface. The same element renders the thumbnail, the full-screen viewer and
 * the printed report, so a mark cannot land in one place on a phone and
 * somewhere else on paper — which is precisely the failure that would discredit
 * an annotated photo in front of a customer.
 *
 * The viewBox is a fixed 1000-unit square scaled by the image's aspect ratio,
 * and every stored coordinate is a fraction of the image, so the drawing scales
 * with whatever size the <img> ends up.
 */
export function AnnotatedPhoto({
  src,
  annotations,
  alt = '',
  className,
  aspect = 4 / 3,
}: {
  src: string;
  annotations?: Annotation[];
  alt?: string;
  className?: string;
  /** Only affects stroke proportions; the image itself is never distorted. */
  aspect?: number;
}) {
  const width = 1000;
  const height = Math.round(width / aspect);

  return (
    <span className={`relative block ${className ?? ''}`}>
      <img src={src} alt={alt} className="block size-full object-contain" />
      {annotations?.length ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden="true"
        >
          {annotations.map((annotation) => (
            <AnnotationShape
              key={annotation.id}
              annotation={annotation}
              width={width}
              height={height}
            />
          ))}
        </svg>
      ) : null}
    </span>
  );
}

export function AnnotationShape({
  annotation,
  width,
  height,
}: {
  annotation: Annotation;
  width: number;
  height: number;
}) {
  const color = ANNOTATION_COLORS[annotation.color];
  const stroke = Math.min(width, height) * STROKE_RATIO;
  // A dark halo under every mark. Red on a dark crawlspace photo and white on a
  // bright wall are both invisible without one, and an inspector choosing a
  // colour that happens to read against this particular photo is not a thing to
  // rely on.
  const halo = stroke * 2.1;

  if (annotation.kind === 'freehand') {
    const path = strokePath(annotation.points, width, height);
    return (
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} stroke="rgba(0,0,0,0.45)" strokeWidth={halo} />
        <path d={path} stroke={color} strokeWidth={stroke} />
      </g>
    );
  }

  if (annotation.kind === 'arrow') {
    const [from, to] = annotation.points;
    if (!from || !to) return null;
    const shaft = `M ${from.x * width} ${from.y * height} L ${to.x * width} ${to.y * height}`;
    const head = arrowHead(from, to, width, height);
    return (
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={shaft} stroke="rgba(0,0,0,0.45)" strokeWidth={halo} />
        <path d={head} stroke="rgba(0,0,0,0.45)" strokeWidth={halo} />
        <path d={shaft} stroke={color} strokeWidth={stroke} />
        <path d={head} stroke={color} strokeWidth={stroke} />
      </g>
    );
  }

  if (annotation.kind === 'box') {
    const [from, to] = annotation.points;
    if (!from || !to) return null;
    const rect = rectOf(from, to);
    const props = {
      x: rect.x * width,
      y: rect.y * height,
      width: rect.width * width,
      height: rect.height * height,
    };
    return (
      <g fill="none">
        <rect {...props} stroke="rgba(0,0,0,0.45)" strokeWidth={halo} />
        <rect {...props} stroke={color} strokeWidth={stroke} />
      </g>
    );
  }

  const anchor = annotation.points[0];
  if (!anchor || !annotation.text) return null;
  const size = Math.min(width, height) * TEXT_RATIO;
  return (
    <text
      x={anchor.x * width}
      y={anchor.y * height}
      fill={color}
      stroke="rgba(0,0,0,0.55)"
      strokeWidth={size * 0.14}
      paintOrder="stroke"
      fontSize={size}
      fontWeight="700"
      fontFamily="system-ui, -apple-system, sans-serif"
      dominantBaseline="hanging"
    >
      {annotation.text}
    </text>
  );
}
