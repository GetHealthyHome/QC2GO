import { useRef, useState } from 'react';
import {
  ANNOTATION_COLORS,
  COLOR_LABELS,
  clampPoint,
  isDegenerate,
  newAnnotationId,
  simplify,
  type Annotation,
  type AnnotationColor,
  type AnnotationKind,
  type Point,
} from '../lib/annotate';
import { AnnotationShape } from './AnnotatedPhoto';
import { usePhotoUrl } from './Photos';
import { Button, cx } from './ui';
import { TrashIcon, XIcon } from './Icons';

const TOOLS: Array<{ kind: AnnotationKind; label: string; hint: string }> = [
  { kind: 'arrow', label: 'Arrow', hint: 'Drag from anywhere to the problem.' },
  { kind: 'box', label: 'Box', hint: 'Drag a rectangle around the area.' },
  { kind: 'freehand', label: 'Draw', hint: 'Trace it with a finger.' },
  { kind: 'text', label: 'Text', hint: 'Tap where the label should sit.' },
];

const COLORS: AnnotationColor[] = ['red', 'amber', 'white'];

/**
 * Marking up a deficiency photo.
 *
 * Built for a thumb rather than a mouse: big targets, one active tool, and undo
 * as the only correction — an inspector standing in a crawlspace is not going
 * to select a shape and edit its properties. Nothing is destructive, so undo
 * genuinely is enough.
 *
 * The original photo is never modified. Marks are stored beside it as
 * coordinates, which is what makes "remove this arrow" possible at all and
 * keeps the evidence itself untouched.
 */
export function PhotoAnnotator({
  photoId,
  annotations,
  onSave,
  onClose,
}: {
  photoId: string;
  annotations: Annotation[];
  onSave: (annotations: Annotation[]) => void;
  onClose: () => void;
}) {
  const url = usePhotoUrl(photoId);
  const surface = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Annotation[]>(annotations);
  const [tool, setTool] = useState<AnnotationKind>('arrow');
  const [color, setColor] = useState<AnnotationColor>('red');
  const [drawing, setDrawing] = useState<Annotation | null>(null);

  /** Pointer position as a fraction of the image box. */
  function pointFrom(event: React.PointerEvent): Point {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return clampPoint({
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    });
  }

  function start(event: React.PointerEvent) {
    if (!url) return;
    const at = pointFrom(event);

    if (tool === 'text') {
      const text = window.prompt('Label');
      if (!text?.trim()) return;
      setDraft((current) => [
        ...current,
        { id: newAnnotationId(), kind: 'text', color, points: [at], text: text.trim() },
      ]);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing({ id: newAnnotationId(), kind: tool, color, points: [at, at] });
  }

  function move(event: React.PointerEvent) {
    if (!drawing) return;
    const at = pointFrom(event);
    setDrawing((current) => {
      if (!current) return current;
      if (current.kind === 'freehand') return { ...current, points: [...current.points, at] };
      return { ...current, points: [current.points[0], at] };
    });
  }

  function end() {
    if (!drawing) return;
    const finished =
      drawing.kind === 'freehand'
        ? { ...drawing, points: simplify(drawing.points) }
        : drawing;
    // A tap with a drag tool selected is somebody missing, not somebody drawing
    // a zero-length arrow.
    if (!isDegenerate(finished)) setDraft((current) => [...current, finished]);
    setDrawing(null);
  }

  const visible = drawing ? [...draft, drawing] : draft;
  const activeHint = TOOLS.find((entry) => entry.kind === tool)?.hint;

  return (
    <div className="safe-pt safe-pb fixed inset-0 z-50 flex flex-col bg-black no-print">
      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close without saving"
          className="flex size-11 items-center justify-center rounded-full text-white/80 active:bg-white/10"
        >
          <XIcon className="size-6" />
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-[13px] text-white/60">
          {activeHint}
        </p>
        <Button className="px-4" onClick={() => onSave(draft)}>
          Done
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-2">
        <div
          ref={surface}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          // Fills the space rather than collapsing to the image's own size:
          // drawing accurately on a thumbnail is not a thing anybody can do,
          // least of all with a gloved thumb.
          //
          // `touch-none` matters as much — without it a drag scrolls the page
          // and picks the image out instead of drawing on it.
          className="relative w-full max-h-full max-w-full touch-none select-none"
          style={{ aspectRatio: '4 / 3' }}
        >
          {url ? (
            <img src={url} alt="" className="pointer-events-none block size-full object-contain" />
          ) : (
            <div className="size-full animate-pulse bg-white/10" />
          )}
          <svg
            viewBox="0 0 1000 750"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full"
          >
            {visible.map((annotation) => (
              <AnnotationShape
                key={annotation.id}
                annotation={annotation}
                width={1000}
                height={750}
              />
            ))}
          </svg>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-2 pb-1">
        <div className="flex gap-1.5">
          {TOOLS.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              aria-pressed={tool === entry.kind}
              onClick={() => setTool(entry.kind)}
              className={cx(
                'flex-1 rounded-xl py-3 text-[13px] font-bold transition-colors',
                tool === entry.kind ? 'bg-white text-ink-900' : 'bg-white/10 text-white/80',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {COLORS.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={COLOR_LABELS[option]}
              aria-pressed={color === option}
              onClick={() => setColor(option)}
              className={cx(
                'flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-colors',
                color === option ? 'bg-white/20 text-white' : 'bg-white/5 text-white/60',
              )}
            >
              <span
                className="size-4 rounded-full border border-white/30"
                style={{ background: ANNOTATION_COLORS[option] }}
              />
              {COLOR_LABELS[option]}
            </button>
          ))}
          <button
            type="button"
            disabled={draft.length === 0}
            onClick={() => setDraft((current) => current.slice(0, -1))}
            aria-label="Undo the last mark"
            className="flex size-11 items-center justify-center rounded-xl bg-white/5 text-white/70 disabled:opacity-30"
          >
            <TrashIcon className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
