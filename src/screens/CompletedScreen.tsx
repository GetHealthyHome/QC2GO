import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { resolveChecklist } from '../lib/checklist';
import { VISIT_TYPE_LABELS, formatDate, overallProgress } from '../lib/inspection';
import { Badge, Card, EmptyState, Screen, TopBar, cx, inputClass } from '../components/ui';
import { AlertIcon, ChevronRightIcon, ClipboardIcon, SearchIcon } from '../components/Icons';

/** History across every job — what an inspector needs to recall a past walkthrough. */
export function CompletedScreen() {
  const { inspections, customers, templates, shared } = useStore();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    return inspections
      .filter((inspection) => inspection.status === 'completed')
      .map((inspection) => {
        const customer = customers.find((c) => c.id === inspection.customerId);
        const checklist = resolveChecklist(inspection, templates, shared);
        const progress = overallProgress(inspection, checklist?.sections ?? []);
        return { inspection, customer, checklist, progress };
      })
      .sort((a, b) =>
        (b.inspection.completedAt ?? '').localeCompare(a.inspection.completedAt ?? ''),
      );
  }, [inspections, customers, templates, shared]);

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
            {visible.map(({ inspection, customer, checklist, progress }) => (
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
