import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { getTemplate } from '../templates';
import { overallProgress, relativeTime } from '../lib/inspection';
import type { Inspection, Job } from '../lib/types';
import { Badge, Button, Card, EmptyState, ProgressBar, Screen, TopBar, cx, inputClass } from '../components/ui';
import { AlertIcon, ClipboardIcon, MapPinIcon, PlusIcon, SearchIcon, SettingsIcon, UserIcon } from '../components/Icons';

interface JobSummary {
  job: Job;
  inspections: Inspection[];
  openDeficiencies: number;
  inProgress: number;
  completed: number;
  lastActivity: string;
}

type Filter = 'active' | 'attention' | 'all';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'all', label: 'All jobs' },
];

export function JobsScreen() {
  const { jobs, inspections } = useStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');

  const summaries = useMemo<JobSummary[]>(() => {
    return jobs
      .map((job) => {
        const jobInspections = inspections.filter((inspection) => inspection.jobId === job.id);
        let openDeficiencies = 0;
        let inProgress = 0;
        let completed = 0;
        for (const inspection of jobInspections) {
          const template = getTemplate(inspection.templateId);
          if (template) openDeficiencies += overallProgress(inspection, template).failed;
          if (inspection.status === 'completed') completed += 1;
          else inProgress += 1;
        }
        const lastActivity = jobInspections.reduce(
          (latest, inspection) =>
            inspection.updatedAt > latest ? inspection.updatedAt : latest,
          job.updatedAt,
        );
        return { job, inspections: jobInspections, openDeficiencies, inProgress, completed, lastActivity };
      })
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }, [jobs, inspections]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return summaries.filter((summary) => {
      const { job } = summary;
      if (filter === 'active' && job.archived) return false;
      if (filter === 'attention' && summary.openDeficiencies === 0 && summary.inProgress === 0) {
        return false;
      }
      if (!needle) return true;
      return [job.name, job.customerName, job.address, job.salesperson, job.teamLeader, job.jobNumber]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle));
    });
  }, [summaries, query, filter]);

  const totals = useMemo(
    () => ({
      inProgress: summaries.reduce((sum, item) => sum + item.inProgress, 0),
      deficiencies: summaries.reduce((sum, item) => sum + item.openDeficiencies, 0),
    }),
    [summaries],
  );

  return (
    <>
      <TopBar
        title="QC2GO"
        subtitle="Quality control inspections"
        actions={
          <Link
            to="/settings"
            aria-label="Settings"
            className="flex size-10 items-center justify-center rounded-xl text-white/80 active:bg-white/10"
          >
            <SettingsIcon className="size-5" />
          </Link>
        }
      />

      <Screen className="pb-28">
        {jobs.length > 0 ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Card className="p-3">
                <p className="text-2xl font-bold text-ink-900">{totals.inProgress}</p>
                <p className="text-xs font-medium text-ink-500">Inspections in progress</p>
              </Card>
              <Card className={cx('p-3', totals.deficiencies > 0 && 'border-fail-200 bg-fail-50')}>
                <p
                  className={cx(
                    'text-2xl font-bold',
                    totals.deficiencies > 0 ? 'text-fail-700' : 'text-ink-900',
                  )}
                >
                  {totals.deficiencies}
                </p>
                <p
                  className={cx(
                    'text-xs font-medium',
                    totals.deficiencies > 0 ? 'text-fail-700' : 'text-ink-500',
                  )}
                >
                  Open deficiencies
                </p>
              </Card>
            </div>

            <div className="relative mb-3">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search job, customer, address…"
                className={cx(inputClass, 'pl-11')}
              />
            </div>

            <div className="mb-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  className={cx(
                    'shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors',
                    filter === option.id
                      ? 'bg-ink-900 text-white'
                      : 'border border-ink-200 bg-white text-ink-600',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon className="size-10" />}
            title={jobs.length === 0 ? 'No jobs yet' : 'Nothing matches'}
            description={
              jobs.length === 0
                ? 'Add a job to start running quality control checklists against it.'
                : 'Try a different search or filter.'
            }
            action={
              jobs.length === 0 ? (
                <Link to="/jobs/new">
                  <Button>
                    <PlusIcon className="size-5" />
                    Add first job
                  </Button>
                </Link>
              ) : null
            }
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visible.map((summary) => (
              <JobCard key={summary.job.id} summary={summary} />
            ))}
          </ul>
        )}
      </Screen>

      <div className="safe-pb pointer-events-none fixed inset-x-0 bottom-0 z-30 no-print">
        <div className="mx-auto w-full max-w-3xl px-3 pb-3">
          <Link to="/jobs/new" className="pointer-events-auto block">
            <Button block className="shadow-lg shadow-brand-600/25">
              <PlusIcon className="size-5" />
              New job
            </Button>
          </Link>
        </div>
      </div>
    </>
  );
}

function JobCard({ summary }: { summary: JobSummary }) {
  const { job, inspections, openDeficiencies, inProgress, completed } = summary;

  return (
    <Card as="li" className="active:bg-ink-50">
      <Link to={`/jobs/${job.id}`} className="block p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[17px] leading-tight font-bold text-ink-900">{job.name}</h2>
          {openDeficiencies > 0 ? (
            <Badge tone="fail">
              <AlertIcon className="size-3" />
              {openDeficiencies}
            </Badge>
          ) : completed > 0 && inProgress === 0 ? (
            <Badge tone="pass">Passed</Badge>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-col gap-1 text-[13px] text-ink-600">
          <span className="flex items-center gap-1.5">
            <UserIcon className="size-3.5 shrink-0 text-ink-400" />
            <span className="truncate">{job.customerName}</span>
          </span>
          {job.address ? (
            <span className="flex items-center gap-1.5">
              <MapPinIcon className="size-3.5 shrink-0 text-ink-400" />
              <span className="truncate">{job.address}</span>
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-100 pt-2.5 text-xs text-ink-500">
          <span className="font-medium">
            {inspections.length === 0
              ? 'No inspections yet'
              : `${inspections.length} inspection${inspections.length === 1 ? '' : 's'}`}
          </span>
          {inProgress > 0 ? <Badge tone="brand">{inProgress} in progress</Badge> : null}
          <span className="ml-auto">{relativeTime(summary.lastActivity)}</span>
        </div>

        {inProgress > 0 ? <InProgressStrip inspections={inspections} /> : null}
      </Link>
    </Card>
  );
}

function InProgressStrip({ inspections }: { inspections: Inspection[] }) {
  const active = inspections.filter((inspection) => inspection.status !== 'completed');
  return (
    <div className="mt-2 flex flex-col gap-2">
      {active.map((inspection) => {
        const template = getTemplate(inspection.templateId);
        if (!template) return null;
        const progress = overallProgress(inspection, template);
        return (
          <div key={inspection.id}>
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-ink-500">
              <span className="truncate">{template.name}</span>
              <span className="shrink-0 tabular-nums">
                {progress.answered}/{progress.total}
              </span>
            </div>
            <ProgressBar value={progress.answered} total={progress.total} />
          </div>
        );
      })}
    </div>
  );
}
