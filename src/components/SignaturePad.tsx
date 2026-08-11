import { useCallback, useEffect, useRef, useState } from 'react';
import type { SignatureRecord } from '../lib/types';
import { Button, TextInput, cx } from './ui';
import { PenIcon } from './Icons';

/**
 * Finger-drawn signature capture. Sized to the device pixel ratio so the saved PNG
 * stays crisp in the printed report.
 */
export function SignaturePad({
  title,
  hint,
  value,
  defaultName,
  onSave,
  onClear,
}: {
  title: string;
  hint?: string;
  value?: SignatureRecord;
  defaultName?: string;
  onSave: (record: SignatureRecord) => void;
  onClear: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState(value?.name ?? defaultName ?? '');

  useEffect(() => {
    if (value?.name) setName(value.name);
  }, [value?.name]);

  const prepareCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2.2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#121820';
  }, []);

  useEffect(() => {
    if (value) return;
    prepareCanvas();
    window.addEventListener('resize', prepareCanvas);
    return () => window.removeEventListener('resize', prepareCanvas);
  }, [prepareCanvas, value]);

  function pointOf(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = pointOf(event);
    context.beginPath();
    context.moveTo(x, y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    event.preventDefault();
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const { x, y } = pointOf(event);
    context.lineTo(x, y);
    context.stroke();
    if (!hasInk) setHasInk(true);
  }

  function end() {
    drawing.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave({
      name: name.trim(),
      dataUrl: canvas.toDataURL('image/png'),
      signedAt: new Date().toISOString(),
    });
  }

  if (value) {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white p-4 break-inside-avoid">
        <p className="text-[13px] font-semibold text-ink-700">{title}</p>
        <img
          src={value.dataUrl}
          alt={`${title} signature`}
          className="mt-2 h-24 w-full rounded-xl border border-ink-100 bg-white object-contain"
        />
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-ink-900">{value.name || '—'}</p>
            <p className="text-xs text-ink-500">
              Signed {new Date(value.signedAt).toLocaleString()}
            </p>
          </div>
          <Button variant="ghost" className="min-h-9 px-3 text-[13px] no-print" onClick={onClear}>
            Re-sign
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-700">
        <PenIcon className="size-4 text-ink-400" />
        {title}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
      <TextInput
        className="mt-3"
        placeholder="Full name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="relative mt-3">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          className="h-36 w-full touch-none rounded-xl border-2 border-dashed border-ink-300 bg-ink-50"
        />
        {!hasInk ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-400">
            Sign here
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={clearCanvas} disabled={!hasInk}>
          Clear
        </Button>
        <Button
          className={cx('flex-1')}
          onClick={save}
          disabled={!hasInk || name.trim().length === 0}
        >
          Save signature
        </Button>
      </div>
    </div>
  );
}
