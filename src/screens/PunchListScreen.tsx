import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCustomer, useCustomerInspections, useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { punchListFor, undocumented, type PunchItem } from '../lib/punch';
import { formatDate, formatDateTime } from '../lib/inspection';
import type { PunchResolution } from '../lib/types';
import { PhotoThumb, PhotoViewer } from '../components/Photos';
import { Badge, Button, Card, EmptyState, Screen, TopBar, cx } from '../components/ui';
import { AlertIcon, CheckIcon, ChevronRightIcon } from '../components/Icons';

/**
 * Everything still open on this customer, across every visit.
 *
 * The question an inspector arrives with on a return visit is "what am I here
 * to re-check?", and until now the only way to answer it was to open past
 * inspections one at a time. Every failure is read back through the snapshot
 * the inspection froze, so the wording here is the wording that was actually
 * failed rather than whatever the checklist says today.
 */
export function PunchListScreen() {
  const { customerId } = useParams();
  const customer = useCustomer(customerId);
  const inspections = useCustomerInspections(customerId);
  const { templates, shared, updateCustomer, settings } = useStore();
  const { profile } = useAuth();
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const list = useMemo(
    () => punchListFor(customer, inspections, templates, shared),
    [customer, inspections, templates, shared],
  );
  const missingEvidence = useMemo(() => undocumented(list.open), [list.open]);

  if (!customer) {
    return (
      <>
        <TopBar title="Punch list" back="/" />
        <Screen>
          <p className="text-sm text-ink-500">That customer is no longer on this device.</p>
        </Screen>
      </>
    );
  }

  function setResolution(item: PunchItem, resolution: PunchResolution | undefined) {
    if (!customer) return;
    const next = { ...(customer.punchResolutions ?? {}) };
    if (resolution) next[item.key] = resolution;
    else delete next[item.key];
    void updateCustomer(customer.id, { punchResolutions: next });
  }

  function close(item: PunchItem) {
    const note = window.prompt('What was done to correct this? (optional)');
    // Cancel means "no, not yet" — an empty note is a perfectly good answer.
    if (note === null) return;
    setResolution(item, {
      at: new Date().toISOString(),
      by: profile?.email ?? (settings.inspectorName || undefined),
      note: note.trim() || undefined,
    });
  }

  return (
    <>
      <TopBar
        title="Punch list"
        subtitle={customer.customerName}
        back={`/customers/${customer.id}`}
      />
      <Screen className="pb-10">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Open" value={list.open.length} tone={list.open.length ? 'fail' : 'pass'} />
          <Stat label="Critical" value={list.criticalOpen} tone={list.criticalOpen ? 'fail' : 'neutral'} />
          <Stat label="Corrected" value={list.resolved.length} tone="pass" />
        </div>

        {missingEvidence.length > 0 ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-warn-50 px-3 py-2.5 text-[13px] font-medium text-warn-700">
            <AlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              {missingEvidence.length} open item{missingEvidence.length === 1 ? '' : 's'} came from
              an inspection signed before the explanation-and-photo rule, so {missingEvidence.length === 1 ? 'it has' : 'they have'}{' '}
              no evidence attached.
            </span>
          </p>
        ) : null}

        <h2 className="mt-6 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Open ({list.open.length})
        </h2>

        {list.open.length === 0 ? (
          <EmptyState
            icon={<CheckIcon className="size-6" />}
            title="Nothing outstanding"
            description={
              list.resolved.length > 0
                ? 'Every deficiency found on this job has been corrected.'
                : 'Failed checkpoints from completed checklists collect here, so a return visit starts with the list rather than a search.'
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {list.open.map((item) => (
              <PunchCard
                key={item.key}
                item={item}
                onOpenPhoto={setViewingPhoto}
                action={
                  <Button variant="secondary" className="w-full" onClick={() => close(item)}>
                    <CheckIcon className="size-4" />
                    Mark corrected
                  </Button>
                }
              />
            ))}
          </div>
        )}

        {list.resolved.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setShowResolved((current) => !current)}
              className="mt-8 flex w-full items-center justify-between px-1 py-2"
            >
              <span className="text-[13px] font-bold tracking-wide text-ink-500 uppercase">
                Corrected ({list.resolved.length})
              </span>
              <ChevronRightIcon
                className={cx('size-5 text-ink-300 transition-transform', showResolved && 'rotate-90')}
              />
            </button>

            {showResolved ? (
              <div className="flex flex-col gap-2">
                {list.resolved.map((item) => (
                  <PunchCard
                    key={item.key}
                    item={item}
                    onOpenPhoto={setViewingPhoto}
                    action={
                      <Button
                        variant="ghost"
                        className="w-full"
                        onClick={() => setResolution(item, undefined)}
                      >
                        Reopen this item
                      </Button>
                    }
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </Screen>

      {viewingPhoto ? (
        <PhotoViewer photoId={viewingPhoto} onClose={() => setViewingPhoto(null)} />
      ) : null}
    </>
  );
}

function PunchCard({
  item,
  action,
  onOpenPhoto,
}: {
  item: PunchItem;
  action: React.ReactNode;
  onOpenPhoto: (id: string) => void;
}) {
  return (
    <Card className={cx('p-4', item.critical && !item.resolution && 'border-fail-200 bg-fail-50/40')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
            {item.sectionTitle} · {formatDate(item.visitDate)}
          </p>
          <p className="mt-0.5 text-[14px] leading-snug font-semibold text-ink-900">
            {item.question.text}
          </p>
        </div>
        {item.critical ? <Badge tone="fail">Critical</Badge> : null}
      </div>

      {item.response.note?.trim() ? (
        <p className="mt-2 rounded-lg bg-ink-50 p-2.5 text-[13px] leading-relaxed text-ink-700">
          {item.response.note}
        </p>
      ) : null}

      {item.response.photoIds.length > 0 ? (
        <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
          {item.response.photoIds.map((photoId) => (
            <PhotoThumb
              key={photoId}
              photoId={photoId}
              size="sm"
              onOpen={() => onOpenPhoto(photoId)}
            />
          ))}
        </div>
      ) : null}

      {item.resolution ? (
        <div className="mt-2 rounded-lg bg-pass-50 p-2.5">
          <p className="text-[13px] font-semibold text-pass-700">
            Corrected {formatDateTime(item.resolution.at)}
            {item.resolution.by ? ` · ${item.resolution.by}` : ''}
          </p>
          {item.resolution.note ? (
            <p className="mt-0.5 text-[13px] leading-relaxed text-pass-700">
              {item.resolution.note}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-1.5">
        {action}
        <Link
          to={`/inspections/${item.inspectionId}/report`}
          className="py-1.5 text-center text-[13px] font-semibold text-brand-700"
        >
          Open the inspection this came from
        </Link>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'pass' | 'fail' | 'neutral';
}) {
  const color =
    tone === 'fail' ? 'text-fail-600' : tone === 'pass' ? 'text-pass-600' : 'text-ink-500';
  return (
    <div className="rounded-xl bg-ink-50 py-2.5">
      <p className={cx('text-xl font-bold tabular-nums', color)}>{value}</p>
      <p className="text-[11px] font-semibold text-ink-500">{label}</p>
    </div>
  );
}
