import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useJob, useStore } from '../lib/store';
import { CATEGORY_LABELS, TEMPLATES, questionCount } from '../templates';
import { VISIT_TYPE_LABELS } from '../lib/inspection';
import type { VisitType } from '../lib/types';
import { Badge, Button, Card, Screen, TopBar, cx } from '../components/ui';
import { ChevronRightIcon } from '../components/Icons';

const VISIT_TYPES: VisitType[] = ['site-visit', 'final-walkthrough', 'punch-recheck'];

const VISIT_DESCRIPTIONS: Record<VisitType, string> = {
  'site-visit': 'Mid-install quality check while the crew is still on site.',
  'final-walkthrough': 'Customer-present sign-off at completion.',
  'punch-recheck': 'Return visit to verify previously flagged items are corrected.',
};

export function TemplatePickerScreen() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const job = useJob(jobId);
  const { createInspection } = useStore();
  const [visitType, setVisitType] = useState<VisitType>('final-walkthrough');
  const [starting, setStarting] = useState(false);

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

  async function start(templateId: string) {
    if (!job || starting) return;
    setStarting(true);
    try {
      const inspection = await createInspection(job.id, templateId, visitType);
      navigate(`/inspections/${inspection.id}`, { replace: true });
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <TopBar title="Start inspection" subtitle={job.name} back={`/jobs/${job.id}`} />
      <Screen className="pb-10">
        <h2 className="mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Visit type
        </h2>
        <div className="mb-6 flex flex-col gap-2">
          {VISIT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setVisitType(type)}
              aria-pressed={visitType === type}
              className={cx(
                'rounded-2xl border-2 px-4 py-3 text-left transition-colors',
                visitType === type
                  ? 'border-brand-600 bg-brand-50'
                  : 'border-ink-200 bg-white active:bg-ink-50',
              )}
            >
              <p
                className={cx(
                  'text-[15px] font-bold',
                  visitType === type ? 'text-brand-800' : 'text-ink-900',
                )}
              >
                {VISIT_TYPE_LABELS[type]}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-500">{VISIT_DESCRIPTIONS[type]}</p>
            </button>
          ))}
        </div>

        <h2 className="mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Checklist
        </h2>
        <p className="mb-2.5 px-1 text-[13px] text-ink-500">
          Every checklist opens with the shared job information and Universal QC Standards section.
        </p>
        <ul className="flex flex-col gap-2.5">
          {TEMPLATES.map((template) => (
            <Card as="li" key={template.id} className="active:bg-ink-50">
              <button
                type="button"
                disabled={starting}
                onClick={() => void start(template.id)}
                className="flex w-full items-center gap-3 p-4 text-left disabled:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <Badge tone="brand">{CATEGORY_LABELS[template.category]}</Badge>
                  <p className="mt-1.5 text-[15px] leading-tight font-bold text-ink-900">
                    {template.name}
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-ink-500">{template.summary}</p>
                  <p className="mt-1.5 text-xs font-medium text-ink-400">
                    {questionCount(template)} checkpoints
                  </p>
                </div>
                <ChevronRightIcon className="size-5 shrink-0 text-ink-300" />
              </button>
            </Card>
          ))}
        </ul>

        <Button
          variant="ghost"
          block
          className="mt-6"
          onClick={() => navigate(`/jobs/${job.id}`)}
        >
          Cancel
        </Button>
      </Screen>
    </>
  );
}
