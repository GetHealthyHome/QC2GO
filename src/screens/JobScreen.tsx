import { Link, useNavigate, useParams } from 'react-router-dom';
import { useJob, useJobInspections, useStore } from '../lib/store';
import { VISIT_TYPE_LABELS, formatDate, overallProgress, relativeTime } from '../lib/inspection';
import { resolveChecklist } from '../lib/checklist';
import type { Inspection } from '../lib/types';
import { Badge, Button, Card, EmptyState, ProgressBar, Screen, TopBar, cx } from '../components/ui';
import {
  AlertIcon,
  ChevronRightIcon,
  ClipboardIcon,
  PenIcon,
  PlusIcon,
  TrashIcon,
} from '../components/Icons';

export function JobScreen() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const job = useJob(jobId);
  const inspections = useJobInspections(jobId);
  const { removeJob } = useStore();

  if (!job) {
    return (
      <>
        <TopBar title="Job not found" back="/" />
        <Screen>
          <p className="text-sm text-ink-500">That job is no longer on this device.</p>
        </Screen>
      </>
    );
  }

  async function handleDelete() {
    if (!job) return;
    const confirmed = window.confirm(
      `Delete "${job.name}" and all ${inspections.length} inspection(s) with their photos? This cannot be undone.`,
    );
    if (!confirmed) return;
    await removeJob(job.id);
    navigate('/', { replace: true });
  }

  const details: Array<[string, string | undefined]> = [
    ['Customer', job.customerName],
    ['Address', job.address],
    ['Phone', job.phone],
    ['Salesperson', job.salesperson],
    ['Team leader', job.teamLeader],
    ['Job #', job.jobNumber],
  ];

  return (
    <>
      <TopBar
        title={job.name}
        subtitle={job.customerName}
        back="/"
        actions={
          <Link
            to={`/jobs/${job.id}/edit`}
            aria-label="Edit job"
            className="flex size-10 items-center justify-center rounded-xl text-white/80 active:bg-white/10"
          >
            <PenIcon className="size-5" />
          </Link>
        }
      />

      <Screen className="pb-28">
        <Card className="p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {details.map(([label, value]) =>
              value ? (
                <div key={label} className={label === 'Address' ? 'col-span-2' : undefined}>
                  <dt className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                    {label}
                  </dt>
                  <dd className="text-[15px] font-medium text-ink-900">{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
          {job.notes ? (
            <p className="mt-3 rounded-xl bg-ink-50 p-3 text-[13px] leading-relaxed text-ink-600">
              {job.notes}
            </p>
          ) : null}
        </Card>

        <h2 className="mt-6 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Inspections
        </h2>

        {inspections.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon className="size-10" />}
            title="No inspections yet"
            description="Start a site visit or final walkthrough checklist for this job."
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {inspections.map((inspection) => (
              <InspectionRow key={inspection.id} inspection={inspection} />
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => void handleDelete()}
          className="mt-8 flex w-full items-center justify-center gap-2 py-3 text-[13px] font-semibold text-fail-600 active:text-fail-700 no-print"
        >
          <TrashIcon className="size-4" />
          Delete job and all inspections
        </button>
      </Screen>

      <div className="safe-pb pointer-events-none fixed inset-x-0 bottom-0 z-30 no-print">
        <div className="mx-auto w-full max-w-3xl px-3 pb-3">
          <Link to={`/jobs/${job.id}/start`} className="pointer-events-auto block">
            <Button block className="shadow-lg shadow-brand-600/25">
              <PlusIcon className="size-5" />
              Start inspection
            </Button>
          </Link>
        </div>
      </div>
    </>
  );
}

function InspectionRow({ inspection }: { inspection: Inspection }) {
  const { templates, shared } = useStore();
  const checklist = resolveChecklist(inspection, templates, shared);
  const progress = overallProgress(inspection, checklist?.sections ?? []);
  const done = inspection.status === 'completed';
  const to = done
    ? `/inspections/${inspection.id}/report`
    : `/inspections/${inspection.id}`;

  return (
    <Card as="li" className={cx('active:bg-ink-50', done && 'bg-ink-50/60')}>
      <Link to={to} className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={done ? 'pass' : 'brand'}>
              {done ? 'Completed' : `${Math.round((progress.answered / (progress.total || 1)) * 100)}%`}
            </Badge>
            <span className="text-[13px] font-semibold text-ink-600">
              {VISIT_TYPE_LABELS[inspection.visitType]}
            </span>
            {progress.failed > 0 ? (
              <Badge tone="fail">
                <AlertIcon className="size-3" />
                {progress.failed} deficienc{progress.failed === 1 ? 'y' : 'ies'}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[15px] leading-tight font-semibold text-ink-900">
            {checklist?.templateName ?? 'Unknown checklist'}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {done
              ? `Signed off ${formatDate(inspection.completedAt)}`
              : `Updated ${relativeTime(inspection.updatedAt)}`}
          </p>
          {!done ? (
            <ProgressBar className="mt-2" value={progress.answered} total={progress.total} />
          ) : null}
        </div>
        <ChevronRightIcon className="size-5 shrink-0 text-ink-300" />
      </Link>
    </Card>
  );
}
