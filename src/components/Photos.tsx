import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { CameraIcon, TrashIcon, XIcon } from './Icons';
import { cx } from './ui';

/** Resolves a stored photo id to an object URL and revokes it when it goes away. */
export function usePhotoUrl(photoId: string | null): string | null {
  const { getPhoto } = useStore();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photoId) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    void getPhoto(photoId).then((photo) => {
      if (cancelled || !photo) return;
      objectUrl = URL.createObjectURL(photo.blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [photoId, getPhoto]);

  return url;
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
  const url = usePhotoUrl(photoId);
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
          <img src={url} alt="" className="size-full object-cover" />
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

export function PhotoViewer({ photoId, onClose }: { photoId: string; onClose: () => void }) {
  const url = usePhotoUrl(photoId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : null}
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
