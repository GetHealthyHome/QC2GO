import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { CameraIcon, PenIcon, TrashIcon, XIcon } from './Icons';
import { cx } from './ui';
import { AnnotatedPhoto } from './AnnotatedPhoto';
import { PhotoAnnotator } from './PhotoAnnotator';
import type { Annotation } from '../lib/annotate';

/**
 * Resolves a stored photo id to an object URL and revokes it when it goes away.
 *
 * `getPhoto` downloads the bytes if this photo came from another device, so the
 * blob can still be missing afterwards — the file has not arrived yet, or there
 * is no signal to fetch it with. The thumbnail stays a placeholder in that case
 * rather than the whole report failing to render.
 */
export function usePhotoUrl(photoId: string | null): string | null {
  return usePhoto(photoId).url;
}

/**
 * The photo's bytes and its marks together.
 *
 * Both are needed almost everywhere one is: a thumbnail, the viewer and the
 * report all draw the annotations over the image, and fetching them separately
 * would let a photo render for a frame with its arrows missing.
 */
export function usePhoto(photoId: string | null): {
  url: string | null;
  annotations?: Annotation[];
} {
  const { getPhoto, inspections } = useStore();
  const [state, setState] = useState<{ url: string | null; annotations?: Annotation[] }>({
    url: null,
  });

  useEffect(() => {
    if (!photoId) {
      setState({ url: null });
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    void getPhoto(photoId).then((photo) => {
      if (cancelled || !photo?.blob) return;
      objectUrl = URL.createObjectURL(photo.blob);
      setState({ url: objectUrl, annotations: photo.annotations });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setState({ url: null });
    };
    // `inspections` is not read here — it is the signal that a save happened,
    // since photos live in IndexedDB rather than in React state.
  }, [photoId, getPhoto, inspections]);

  return state;
}

export function PhotoThumb({
  photoId,
  onOpen,
  onRemove,
  size = 'md',
}: {
  photoId: string;
  onOpen?: () => void;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}) {
  const { url, annotations } = usePhoto(photoId);
  const box = size === 'sm' ? 'size-16' : 'size-20';

  return (
    <div className={cx('relative shrink-0', box)}>
      <button
        type="button"
        onClick={onOpen}
        className={cx(
          'size-full overflow-hidden rounded-xl border border-ink-200 bg-ink-100',
          onOpen && 'active:opacity-80',
        )}
        aria-label="View photo"
      >
        {url ? (
          <AnnotatedPhoto src={url} annotations={annotations} className="size-full" aspect={1} />
        ) : (
          <span className="block size-full animate-pulse bg-ink-200" />
        )}
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove photo"
          className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border-2 border-white bg-ink-800 text-white shadow-sm active:bg-fail-600"
        >
          <TrashIcon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

export function PhotoViewer({
  photoId,
  onClose,
  editable = false,
}: {
  photoId: string;
  onClose: () => void;
  /** Offers the annotator. Off on a signed report, where nothing may change. */
  editable?: boolean;
}) {
  const { url, annotations } = usePhoto(photoId);
  const { savePhotoAnnotations } = useStore();
  const [annotating, setAnnotating] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !annotating) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, annotating]);

  if (annotating) {
    return (
      <PhotoAnnotator
        photoId={photoId}
        annotations={annotations ?? []}
        onClose={() => setAnnotating(false)}
        onSave={(next) => {
          void savePhotoAnnotations(photoId, next);
          setAnnotating(false);
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 no-print"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="safe-pt absolute top-3 right-3 flex size-11 items-center justify-center rounded-full bg-white/15 text-white"
      >
        <XIcon className="size-6" />
      </button>

      {url ? (
        <AnnotatedPhoto
          src={url}
          annotations={annotations}
          className="max-h-full max-w-full"
          aspect={4 / 3}
        />
      ) : null}

      {editable ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setAnnotating(true);
          }}
          className="safe-pb absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-5 py-3 text-[14px] font-bold text-ink-900"
        >
          <PenIcon className="size-4" />
          {annotations?.length ? 'Edit marks' : 'Mark up'}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Camera capture. `capture="environment"` sends phones straight to the rear camera,
 * while desktop browsers fall back to a normal file picker so office review still works.
 */
export function AddPhotoButton({
  inspectionId,
  questionId,
  tone = 'neutral',
  label = 'Take photo',
}: {
  inspectionId: string;
  questionId: string;
  tone?: 'neutral' | 'fail';
  label?: string;
}) {
  const { addPhoto } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await addPhoto(inspectionId, questionId, file);
      }
    } catch (error) {
      console.error('Could not save photo', error);
      alert('That photo could not be saved. Check available storage and try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className={cx(
          'flex size-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-[11px] font-semibold transition-colors disabled:opacity-50',
          tone === 'fail'
            ? 'border-fail-300 bg-fail-50 text-fail-700 active:bg-fail-100'
            : 'border-ink-300 bg-ink-50 text-ink-600 active:bg-ink-100',
        )}
      >
        <CameraIcon className="size-6" />
        {busy ? 'Saving…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />
    </>
  );
}
