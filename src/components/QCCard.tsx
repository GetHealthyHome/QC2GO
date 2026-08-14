import { Link } from 'react-router-dom';
import type { Inspection } from '../lib/types';
import { formatDate, overallProgress, scoreBand, scoreOf } from '../lib/inspection';
import { punchListFor } from '../lib/punch';
import { resolveChecklist } from '../lib/checklist';
import { useStore } from '../lib/store';
import { Badge, Card, ProgressBar, cx } from './ui';
import { AlertIcon, ChevronRightIcon } from './Icons';

/**
 * The outline is the result, readable without reading anything.
 *
 * A `ring` rather than a border. `Card` already sets `border-ink-200`, and two
 * border-colour utilities on one element do not resolve by the order they are
 * written in the class attribute — the winner is whichever Tailwind emitted
 * later, which is not something this file can see or rely on. The old
 * `border-pass-200` here was in that fight and losing it silently. A ring is a
 * different property, so it cannot be overridden by accident, and it draws
 * outside the border where an outline belongs.
 *
 * Green for a pass, red for a failure, amber in between: a score can be too low
 * to sign off on and too high to call a failure, and colouring that red would
 * put it beside a job with a dead CO alarm.
 */
const BAND_STYLES = {
  pass: { ring: 'ring-2 ring-pass-500', chip: 'bg-pass-500', text: 'text-pass-700' },
  watch: { ring: 'ring-2 ring-warn-500', chip: 'bg-warn-500', text: 'text-warn-700' },
  fail: { ring: 'ring-2 ring-fail-500', chip: 'bg-fail-500', text: 'text-fail-700' },
} as const;

/**
 * The record of one completed checklist on one day. Score excludes N/A items, and
 * any critical failure forces the band to red however high the percentage is —
 * a 97% with a failed CO alarm check is not a pass.
 */
export function QCCard({ inspection }: { inspection: Inspection }) {
  const { templates, shared, customers } = useStore();
  const checklist = resolveChecklist(inspection, templates, shared);
  const sections = checklist?.sections ?? [];
  const done = inspection.status === 'completed';

  if (!done) {
    const progress = overallProgress(inspection, sections);
    return (
      <Card className="active:bg-ink-50">
        <Link to={`/inspections/${inspection.id}`} className="flex items-center gap-3 p-3.5">
          <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <span className="text-[15px] leading-none font-bold tabular-nums">
              {progress.total === 0
                ? 0
                : Math.round((progress.answered / progress.total) * 100)}
              %
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] leading-tight font-semibold text-ink-900">
              {checklist?.templateName ?? 'Unknown checklist'}
            </p>
            <p className="text-xs text-ink-500">
              In progress · {progress.answered} of {progress.total} answered
            </p>
            <ProgressBar className="mt-1.5" value={progress.answered} total={progress.total} />
          </div>
          <ChevronRightIcon className="size-5 shrink-0 text-ink-300" />
        </Link>
      </Card>
    );
  }

  const score = scoreOf(inspection, sections);
  const band = scoreBand(score);
  const style = BAND_STYLES[band];

  /**
   * How many of this run's failures are still somebody's job.
   *
   * Read through the punch list rather than counted off the score, because the
   * two answer different questions. `score.failed` is what this checklist found
   * on the day and never changes — it is the record. This is what is left, and
   * it drops as items are corrected from the punch list. A card that kept
   * saying "3 failed" a fortnight after all three were fixed would send
   * somebody back to a job that is finished.
   */
  const customer = customers.find((candidate) => candidate.id === inspection.customerId);
  const punch = punchListFor(customer, [inspection], templates, shared);

  return (
    <Card className={cx('active:bg-ink-50', style.ring)}>
      <Link to={`/inspections/${inspection.id}/report`} className="flex items-center gap-3 p-3.5">
        <span
          className={cx(
            'flex size-12 shrink-0 flex-col items-center justify-center rounded-xl text-white',
            style.chip,
          )}
        >
          <span className="text-[15px] leading-none font-bold tabular-nums">{score.percent}%</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] leading-tight font-semibold text-ink-900">
            {checklist?.templateName ?? 'Unknown checklist'}
          </p>
          <p className="text-xs text-ink-500">
            {formatDate(inspection.visitDate)} · {score.passed} passed, {score.failed} failed
          </p>
          {punch.open.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Badge tone="fail">
                <AlertIcon className="size-3" />
                {punch.open.length} to address
              </Badge>
              {punch.criticalOpen > 0 ? (
                <Badge tone="fail">{punch.criticalOpen} critical</Badge>
              ) : null}
            </div>
          ) : score.failed > 0 ? (
            // Said rather than left blank. A card with failures on it and no
            // badge reads as one nobody has looked at yet.
            <Badge tone="pass" className="mt-1">
              All {score.failed} corrected
            </Badge>
          ) : null}
        </div>
        <ChevronRightIcon className="size-5 shrink-0 text-ink-300" />
      </Link>
    </Card>
  );
}
