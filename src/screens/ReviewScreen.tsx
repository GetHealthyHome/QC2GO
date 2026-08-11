import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useChecklist, useInspection, useJob, useStore } from '../lib/store';
import {
  VISIT_TYPE_LABELS,
  completionBlockers,
  deficiencies,
  missingEvidencePhotos,
  overallProgress,
} from '../lib/inspection';
import type { SignatureRecord } from '../lib/types';
import { PhotoThumb, PhotoViewer } from '../components/Photos';
import { SignaturePad } from '../components/SignaturePad';
import { Badge, Button, Card, Screen, TopBar, cx, inputClass } from '../components/ui';
import { AlertIcon, CameraIcon, CheckIcon, ChevronRightIcon } from '../components/Icons';

export function ReviewScreen() {
  const { inspectionId } = useParams();
  const navigate = useNavigate();
  const inspection = useInspection(inspectionId);
  const job = useJob(inspection?.jobId);
  const { updateInspection, settings } = useStore();
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const checklist = useChecklist(inspection);

  const blockers = useMemo(
    () =>
      inspection && checklist
        ? completionBlockers(inspection, checklist.sections, checklist.infoFields)
        : [],
    [inspection, checklist],
  );
  const failures = useMemo(
    () => (inspection && checklist ? deficiencies(inspection, checklist.sections) : []),
    [inspection, checklist],
  );
  const advisories = useMemo(
    () => (inspection && checklist ? missingEvidencePhotos(inspection, checklist.sections) : []),
    [inspection, checklist],
  );

  if (!inspection || !checklist) {
    return (
      <>
        <TopBar title="Inspection not found" back="/" />
        <Screen>
          <p className="text-sm text-ink-500">That inspection is no longer on this device.</p>
        </Screen>
      </>
    );
  }

  const progress = overallProgress(inspection, checklist.sections);
  const canComplete = blockers.length === 0;
  const requiresCustomerSignature =
    inspection.visitType === 'final-walkthrough' && inspection.info.customerPresent === 'Yes';

  function complete() {
    setAttempted(true);
    if (!canComplete || !inspection) return;
    updateInspection(inspection.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
    navigate(`/inspections/${inspection.id}/report`, { replace: true });
  }

  function saveSignature(key: 'inspectorSignature' | 'customerSignature', record?: SignatureRecord) {
    if (!inspection) return;
    updateInspection(inspection.id, { [key]: record });
  }

  return (
    <>
      <TopBar
        title="Review & sign"
        subtitle={job?.name}
        back={`/inspections/${inspection.id}`}
      />

      <Screen className="pb-32">
        <Card className="p-4">
          <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
            {VISIT_TYPE_LABELS[inspection.visitType]}
          </p>
          <p className="mt-0.5 text-[15px] font-bold text-ink-900">{checklist.templateName}</p>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <Stat label="Passed" value={progress.passed} tone="pass" />
            <Stat label="Failed" value={progress.failed} tone="fail" />
            <Stat label="N/A" value={progress.na} tone="neutral" />
            <Stat label="Open" value={progress.total - progress.answered} tone="warn" />
          </div>
        </Card>

        {attempted && !canComplete ? (
          <Card className="mt-3 border-fail-200 bg-fail-50 p-4">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-fail-700">
              <AlertIcon className="size-4" />
              {blockers.length} item{blockers.length === 1 ? '' : 's'} still block sign-off
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {blockers.slice(0, 12).map((blocker, index) => (
                <li key={`${blocker.kind}-${blocker.questionId ?? index}`}>
                  {blocker.questionId && blocker.sectionId ? (
                    <Link
                      to={`/inspections/${inspection.id}?step=${blocker.sectionId}&focus=${blocker.questionId}`}
                      className="flex items-center gap-1.5 text-[13px] font-medium text-fail-700 underline underline-offset-2"
                    >
                      <span className="line-clamp-2">{blocker.label}</span>
                      <ChevronRightIcon className="size-4 shrink-0" />
                    </Link>
                  ) : (
                    <span className="text-[13px] font-medium text-fail-700">{blocker.label}</span>
                  )}
                </li>
              ))}
              {blockers.length > 12 ? (
                <li className="text-[13px] font-medium text-fail-700">
                  …and {blockers.length - 12} more
                </li>
              ) : null}
            </ul>
          </Card>
        ) : null}

        <h2 className="mt-6 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Deficiencies ({failures.length})
        </h2>
        {failures.length === 0 ? (
          <Card className="flex items-center gap-2.5 border-pass-200 bg-pass-50 p-4">
            <CheckIcon className="size-5 shrink-0 text-pass-600" strokeWidth={3} />
            <p className="text-[13px] font-semibold text-pass-700">
              No deficiencies recorded on this inspection.
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {failures.map(({ question, response, sectionId, sectionTitle }) => (
              <Card as="li" key={question.id} className="border-fail-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                      {sectionTitle}
                    </p>
                    <p className="mt-0.5 text-[15px] leading-snug font-semibold text-ink-900">
                      {question.text}
                    </p>
                  </div>
                  {question.critical ? <Badge tone="warn">Critical</Badge> : null}
                </div>
                {response.note?.trim() ? (
                  <p className="mt-2 rounded-xl bg-fail-50 p-3 text-[13px] leading-relaxed text-ink-700">
                    {response.note}
                  </p>
                ) : (
                  <p className="mt-2 text-[13px] font-semibold text-fail-600">
                    Explanation missing.
                  </p>
                )}
                {response.photoIds.length > 0 ? (
                  <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {response.photoIds.map((photoId) => (
                      <PhotoThumb
                        key={photoId}
                        photoId={photoId}
                        size="sm"
                        onOpen={() => setViewingPhoto(photoId)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[13px] font-semibold text-fail-600">Photo missing.</p>
                )}
                <Link
                  to={`/inspections/${inspection.id}?step=${sectionId}&focus=${question.id}`}
                  className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700"
                >
                  Edit item
                  <ChevronRightIcon className="size-4" />
                </Link>
              </Card>
            ))}
          </ul>
        )}

        {advisories.length > 0 ? (
          <Card className="mt-3 border-brand-200 bg-brand-50 p-4">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-brand-800">
              <CameraIcon className="size-4" />
              {advisories.length} record photo{advisories.length === 1 ? '' : 's'} not attached
            </p>
            <p className="mt-1 text-[13px] text-brand-800/80">
              These passed but are normally photographed for the file. Sign-off is not blocked.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {advisories.map(({ question, sectionId }) => (
                <li key={question.id}>
                  <Link
                    to={`/inspections/${inspection.id}?step=${sectionId}&focus=${question.id}`}
                    className="text-[13px] font-medium text-brand-800 underline underline-offset-2"
                  >
                    {question.text}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <h2 className="mt-6 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Summary notes
        </h2>
        <textarea
          rows={4}
          value={inspection.summaryNotes ?? ''}
          placeholder="Overall condition, follow-up scheduled, anything the office needs to know."
          onChange={(event) =>
            updateInspection(inspection.id, { summaryNotes: event.target.value })
          }
          className={inputClass}
        />

        <h2 className="mt-6 mb-2.5 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">
          Signatures
        </h2>
        <div className="flex flex-col gap-2.5">
          <SignaturePad
            title="Inspector"
            hint="Confirms this record is accurate and complete."
            value={inspection.inspectorSignature}
            defaultName={inspection.info.inspector || settings.inspectorName}
            onSave={(record) => saveSignature('inspectorSignature', record)}
            onClear={() => saveSignature('inspectorSignature', undefined)}
          />
          <SignaturePad
            title={`Customer${requiresCustomerSignature ? '' : ' (optional)'}`}
            hint={
              requiresCustomerSignature
                ? 'Required — this is a final walkthrough with the customer present.'
                : 'Capture if the customer is on site.'
            }
            value={inspection.customerSignature}
            defaultName={inspection.info.customerName}
            onSave={(record) => saveSignature('customerSignature', record)}
            onClear={() => saveSignature('customerSignature', undefined)}
          />
        </div>
      </Screen>

      <div className="safe-pb fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur no-print">
        <div className="mx-auto w-full max-w-3xl px-3 py-3">
          {!canComplete ? (
            <p className="mb-2 text-center text-xs font-semibold text-ink-500">
              {blockers.length} item{blockers.length === 1 ? '' : 's'} remaining before sign-off
            </p>
          ) : null}
          <Button
            block
            onClick={complete}
            className={cx(!canComplete && 'bg-ink-300')}
          >
            <CheckIcon className="size-5" strokeWidth={3} />
            Complete inspection
          </Button>
        </div>
      </div>

      {viewingPhoto ? (
        <PhotoViewer photoId={viewingPhoto} onClose={() => setViewingPhoto(null)} />
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'pass' | 'fail' | 'neutral' | 'warn';
}) {
  const color =
    tone === 'pass'
      ? 'text-pass-600'
      : tone === 'fail'
        ? 'text-fail-600'
        : tone === 'warn'
          ? 'text-warn-600'
          : 'text-ink-500';
  return (
    <div className="rounded-xl bg-ink-50 py-2.5">
      <p className={cx('text-xl font-bold tabular-nums', color)}>{value}</p>
      <p className="text-[11px] font-semibold text-ink-500">{label}</p>
    </div>
  );
}
