import { useEffect, useState } from 'react';
import { OfflineIcon } from './Icons';

/**
 * Inspectors work in basements and crawlspaces. Everything already saves locally,
 * so this is reassurance rather than a warning.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const online = () => setOffline(false);
    const down = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="safe-pt bg-warn-500 text-white no-print">
      <p className="mx-auto flex w-full max-w-3xl items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold">
        <OfflineIcon className="size-4" />
        Offline — everything is saving to this device
      </p>
    </div>
  );
}
