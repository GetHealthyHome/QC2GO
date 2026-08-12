import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { integrityFlags, type IntegrityFlag } from '../lib/integrity';
import type { Customer, Inspection } from '../lib/types';
import { Badge, Card } from './ui';
import { AlertIcon, CheckIcon } from './Icons';

/**
 * Whether this inspection looks like it was actually walked.
 *
 * Shown to admins on a signed report, and phrased as a question rather than a
 * finding. Everything here is a heuristic over timing and coordinates: it is a
 * reason to open a record and ask, and it is wrong often enough that stating it
 * any more strongly than that would be dishonest.
 *
 * Not printed. A supervisor's prompt has no business on the copy handed to a
 * customer, and a flag that turned out to be nothing would be on paper forever.
 */
export function IntegrityPanel({
  inspection,
  customer,
}: {
  inspection: Inspection;
  customer?: Customer;
}) {
  const { inspections, getInspectionPhotos } = useStore();
  const [flags, setFlags] = useState<IntegrityFlag[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getInspectionPhotos(inspection.id).then((photos) => {
      if (cancelled) return;
      setFlags(integrityFlags({ inspection, history: inspections, photos, customer }));
    });
    return () => {
      cancelled = true;
    };
  }, [inspection, inspections, customer, getInspectionPhotos]);

  // Nothing at all until the photos are read, rather than a "clear" that might
  // become a flag a moment later.
  if (flags === null) return null;

  return (
    <section className="mt-5 no-print">
      <h2 className="mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
        Record checks
      </h2>
      <Card className="p-4">
        {flags.length === 0 ? (
          <div className="flex items-center gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-pass-500 text-white">
              <CheckIcon className="size-3.5" strokeWidth={4} />
            </span>
            <p className="text-[14px] text-ink-700">
              Nothing unusual in the timing or the photo locations.
            </p>
          </div>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-ink-100">
              {flags.map((flag) => (
                <li key={flag.kind} className="flex items-start gap-2.5 py-2.5 first:pt-0">
                  <AlertIcon className="mt-0.5 size-5 shrink-0 text-warn-600" />
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-ink-900">{flag.label}</p>
                    <p className="text-[13px] leading-snug text-ink-600">{flag.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-ink-100 pt-3 text-[12px] leading-relaxed text-ink-500">
              These are prompts to look, not findings. Timing and GPS are both noisy — a fix taken
              in a basement can be a long way out, and a familiar scope is genuinely quick.
            </p>
          </>
        )}
        <Badge className="mt-3" tone="neutral">
          Visible to admins only
        </Badge>
      </Card>
    </section>
  );
}
