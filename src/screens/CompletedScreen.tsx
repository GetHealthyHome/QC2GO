import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { resolveChecklist } from '../lib/checklist';
import { VISIT_TYPE_LABELS, formatDate, overallProgress } from '../lib/inspection';
import {
  checkpointRows,
  downloadCsv,
  exportFilename,
  inspectionRows,
  toCsv,
} from '../lib/exportCsv';
import { velocityFlag, baselineFor } from '../lib/integrity';
import { Badge, Button, Card, EmptyState, Screen, TopBar, cx, inputClass } from '../components/ui';
import { AlertIcon, ChevronRightIcon, ClipboardIcon, SearchIcon, ShareIcon } from '../components/Icons';

/** History across every job — what an inspector needs to recall a past walkthrough. */
export function CompletedScreen() {
  const { inspections, customers, templates, shared, isAdmin } = useStore();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    return inspections
      .filter((inspection) => inspection.status === 'completed')
      .map((inspection) => {
        const customer = customers.find((c) => c.id === inspection.customerId);
        const checklist = resolveChecklist(inspection, templates, shared);
        const progress = overallProgress(inspection, checklist?.sections ?? []);
        /*
         * Only the timing check here. The photo one needs every photo record
         * for the inspection, and those carry the image bytes — loading them
         * for a whole history to draw one badge would be a great deal of memory
         * for very little. It runs on the report, where the photos are already
         * open.
         *
         * Admins only, and not because it is secret: telling the person being
         * measured where the line sits is how you teach them to pace just above
         * it, which would leave the check firing on nobody and meaning nothing.
         */
        const flag = isAdmin
          ? velocityFlag(inspection, baselineFor(inspections, inspection.info.inspector, inspection.id))
          : null;
        return { inspection, customer, checklist, progress, flag };
      })
      .sort((a, b) =>
        (b.inspection.completedAt ?? '').localeCompare(a.inspection.completedAt ?? ''),
      );
  }, [inspections, customers, templates, shared, isAdmin]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [
        row.customer?.customerName,
        row.customer?.address,
        row.checklist?.templateName,
        row.inspection.info.inspector,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  /**
   * Built from what this device already holds, so it works with no signal —
   * the same reason everything else here does. The `inspection_summary` view is
   * the other half, for anything pointing a BI tool at the database.
   */
  function download(kind: 'inspections' | 'checkpoints') {
    const build = kind === 'inspections' ? inspectionRows : checkpointRows;
    downloadCsv(exportFilename(kind), toCsv(build(inspections, customers, templates, shared)));
  }

  return (
    <>
      <TopBar title="Completed inspections" subtitle={`${rows.length} on this device`} back="/" />
      <Screen className="pb-10">
        {rows.length > 0 ? (
          <div className="relative mb-3">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customer, checklist, inspector…"
              className={cx(inputClass, 'pl-11')}
            />
          </div>
        ) : null}

        {rows.length > 0 ? (
          <Card className="mb-3 p-3.5">
            <p className="text-[13px] font-semibold text-ink-900">Export for the office</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
              One row per inspection to see how the month went, or one row per checkpoint to
              pivot on which questions fail most often.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => download('inspections')}>
                <ShareIcon className="size-4" />
                Inspections
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => download('checkpoints')}>
                <ShareIcon className="size-4" />
                Checkpoints
              </Button>
            </div>
          </Card>
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon className="size-10" />}
            title={rows.length === 0 ? 'No completed inspections yet' : 'Nothing matches'}
            description={
              rows.length === 0
                ? 'Signed-off inspections appear here so you can pull up any past walkthrough.'
                : 'Try a different search.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visible.map(({ inspection, customer, checklist, progress, flag }) => (
              <Card as="li" key={inspection.id} className="active:bg-ink-50">
                <Link
                  to={`/inspections/${inspection.id}/report`}
                  className="flex items-center gap-3 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="pass">{VISIT_TYPE_LABELS[inspection.visitType]}</Badge>
                      {progress.failed > 0 ? (
                        <Badge tone="fail">
                          <AlertIcon className="size-3" />
                          {progress.failed}
                        </Badge>
                      ) : null}
                      {flag ? (
                        <Badge tone="warn">
                          <AlertIcon className="size-3" />
                          {flag.label}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[15px] leading-tight font-bold text-ink-900">
                      {customer?.customerName ?? 'Deleted customer'}
                    </p>
                    <p className="text-[13px] text-ink-600">
                      {checklist?.templateName ?? 'Unknown checklist'}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {formatDate(inspection.completedAt)}
                      {inspection.info.inspector ? ` · ${inspection.info.inspector}` : ''}
                    </p>
                  </div>
                  <ChevronRightIcon className="size-5 shrink-0 text-ink-300" />
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </Screen>
    </>
  );
}
