import { useCallback, useEffect, useRef, useState } from 'react';
import { findEngine } from '../lib/barcode';
import { Button } from './ui';
import { BarcodeIcon, XIcon } from './Icons';

/**
 * Pointing the camera at a data plate.
 *
 * The scanner stays open after a hit rather than closing on the first one. A
 * ductless job has a serial on the outdoor unit and one on every head, and an
 * inspector who has already climbed behind the unit should get all of them in
 * one go instead of reopening the camera five times.
 *
 * Deciding what to keep is not this component's job — it reports every decode it
 * sees, many times a second, including the same plate over and over. The caller
 * merges, which is where the repeat-suppression lives and where it can be
 * tested without a camera.
 */
export function BarcodeScanner({
  onCode,
  onClose,
  captured,
}: {
  onCode: (raw: string) => void;
  onClose: () => void;
  /** How many codes the field holds, so the inspector can see it working. */
  captured: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  // Held in a ref rather than state: the detect loop reads it on every frame,
  // and a re-render per frame would be a waste on the phone doing the decoding.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const stop = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    const engine = findEngine();
    if (!engine) {
      setError('This device cannot scan. Type the number in instead.');
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The back camera, and a resolution high enough to resolve the thin
          // bars on a Code 128 label without asking the phone to decode 4K.
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (cancelled || !videoRef.current?.videoWidth) return;
          try {
            const found = await engine.detect(videoRef.current);
            for (const code of found) {
              if (!code.rawValue) continue;
              onCodeRef.current(code.rawValue);
              setLast(code.rawValue);
              // A phone in a crawlspace is often somewhere the screen cannot be
              // seen. A buzz is the only feedback that reliably arrives.
              navigator.vibrate?.(40);
            }
          } catch {
            // A frame that will not decode is the normal case, not an error.
          }
          // Several times a second is plenty and leaves the phone responsive;
          // every frame would heat it up for no extra reads.
          timer = window.setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch (cameraError) {
        if (cancelled) return;
        const denied =
          cameraError instanceof DOMException && cameraError.name === 'NotAllowedError';
        setError(
          denied
            ? 'Camera access was refused. Allow it in your browser settings, or type the number in.'
            : 'The camera could not be opened. Type the number in instead.',
        );
      }
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      stop();
    };
  }, [stop]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="safe-pt flex items-center justify-between px-4 py-3">
        <p className="text-[15px] font-semibold text-white">Scan the data plate</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="flex size-10 items-center justify-center rounded-full bg-white/15 text-white"
        >
          <XIcon className="size-5" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className="size-full object-cover"
        />
        {/* A frame to aim with. The decoder reads the whole image — this is for
            the person holding the phone, not for the engine. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-32 w-4/5 rounded-xl border-2 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
        </div>

        {error ? (
          <div className="absolute inset-x-0 bottom-0 bg-black/80 p-5 text-center">
            <BarcodeIcon className="mx-auto size-8 text-white/50" />
            <p className="mt-2 text-[14px] text-white">{error}</p>
          </div>
        ) : null}
      </div>

      <div className="safe-pb bg-black px-5 py-4">
        {last ? (
          <p className="truncate text-center text-[15px] font-semibold text-white">{last}</p>
        ) : (
          <p className="text-center text-[13px] text-white/60">
            Hold the code inside the frame.
          </p>
        )}
        <Button block className="mt-3" onClick={onClose}>
          {captured > 0 ? `Done — ${captured} captured` : 'Done'}
        </Button>
      </div>
    </div>
  );
}
