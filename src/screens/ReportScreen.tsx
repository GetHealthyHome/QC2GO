import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useChecklist, useCustomer, useInspection, useStore } from '../lib/store';
import {
  VISIT_TYPE_LABELS,
  formatDate,
  formatDateTime,
  getResponse,
  isScored,
  overallProgress,
  sectionProgress,
} from '../lib/inspection';
import type { Answer, Question, Section, SignatureRecord } from '../lib/types';
import { PhotoViewer, usePhoto } from '../components/Photos';
import { AnnotatedPhoto } from '../components/AnnotatedPhoto';
import { Badge, Button, Card, Screen, TopBar, cx } from '../components/ui';
import { Letterhead } from '../components/Letterhead';
import { letterheadName } from '../lib/branding';
import { downloadFile } from '../lib/exportCsv';
import { useAuth } from '../lib/auth';
import { AlertIcon, CheckIcon, MinusIcon, PenIcon, PrinterIcon, ShareIcon, XIcon } from '../components/Icons';

export function ReportScreen() {
  const { inspectionId } = useParams();
  const inspection = useInspection(inspectionId);
  const customer = useCustomer(inspection?.customerId);
  const { updateInspection, settings } = useStore();
  const { profile } = useAuth();
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  const checklist = useChecklist(inspection);
  const sections = useMemo(() => checklist?.sections ?? [], [checklist]);

  if (!inspection || !checklist) {
    return (
      <>
        <TopBar title="Report not found" back="/" />
        <Screen>
          <p className="text-sm text-ink-500">That inspection is no longer on this device.</p>
        </Screen>
      </>
    );
  }

  const progress = overallProgress(inspection, sections);
  const completed = inspection.status === 'completed';

  function exportJson() {
    if (!inspection) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      company: settings.companyName || undefined,
      customer,
      inspection: { ...inspection, template: checklist!.templateName },
    };
    downloadFile(
      `${(customer?.customerName ?? 'inspection').replace(/[^\w-]+/g, '-')}-${inspection.id}.json`,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    );
  }

  /**
   * Unlocking a signed record is the one action here that rewrites history, so
   * it does not happen without a reason attached. The reason lands on the
   * inspection — visible in the report, and carried offline like everything
   * else — and the server copies it into an append-only ledger when the change
   * syncs, which is the copy nobody can edit.
   */
  function reopen() {
    if (!inspection) return;
    const reason = window.prompt(
      'Reopening a signed inspection is recorded permanently. Why is it being reopened?',
    );
    if (reason === null) return;
    if (!reason.trim()) {
      alert('A reason is required to reopen a signed inspection.');
      return;
    }
    updateInspection(inspection.id, {
      status: 'in-progress',
      completedAt: undefined,
      // The stored result goes with the sign-off that produced it. Leaving it
      // behind would let a webhook or a spreadsheet report a verdict on a
      // record that no longer has one, and it is rewritten on re-completion.
      overallScore: undefined,
      passFailStatus: undefined,
      totalDeficiencies: undefined,
      reopenings: [
        ...(inspection.reopenings ?? []),
        { reason: reason.trim(), at: new Date().toISOString(), by: profile?.email },
      ],
    });
  }

  return (
    <>
      <TopBar
        title="Inspection report"
        subtitle={customer?.customerName}
        back={customer ? `/customers/${customer.id}` : '/'}
        actions={
          <button
            type="button"
            onClick={() => window.print()}
            aria-label="Print report"
            className="flex size-10 items-center justify-center rounded-xl text-white/80 active:bg-white/10"
          >
            <PrinterIcon className="size-5" />
          </button>
        }
      />

      <Screen className="pb-10">
        <Letterhead
          logo={profile?.organization?.logo}
          companyName={letterheadName(profile?.organization?.name, settings.companyName)}
          title={`${checklist.templateName} — ${VISIT_TYPE_LABELS[inspection.visitType]}`}
          meta={customer?.address}
        />

        <Card className="p-4 print-plain">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                {VISIT_TYPE_LABELS[inspection.visitType]}
              </p>
              <h2 className="mt-0.5 text-lg leading-tight font-bold text-ink-900">
                {customer?.customerName ?? 'Customer'}
              </h2>
              <p className="text-[13px] text-ink-500">{checklist.templateName}</p>
            </div>
            <Badge tone={completed ? 'pass' : 'warn'}>
              {completed ? 'Completed' : 'In progress'}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <Stat label="Passed" value={progress.passed} tone="pass" />
            <Stat label="Failed" value={progress.failed} tone="fail" />
            <Stat label="N/A" value={progress.na} tone="neutral" />
            <Stat label="Unanswered" value={progress.total - progress.answered} tone="warn" />
          </div>

          <p className="mt-3 text-xs text-ink-500">
            {completed
              ? `Signed off ${formatDateTime(inspection.completedAt)}`
              : `Last updated ${formatDateTime(inspection.updatedAt)}`}
          </p>
        </Card>

        <ReportSection title="Job Information">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {checklist.infoFields.map((field) => {
              const value = inspection.info[field.id];
              if (!value?.trim()) return null;
              return (
                <div key={field.id} className={field.half ? undefined : 'col-span-2'}>
                  <dt className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                    {field.label}
                  </dt>
                  <dd className="text-[14px] font-medium text-ink-900">
                    {field.type === 'date' ? formatDate(value) : value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </ReportSection>

        {inspection.summaryNotes?.trim() ? (
          <ReportSection title="Summary Notes">
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink-700">
              {inspection.summaryNotes}
            </p>
          </ReportSection>
        ) : null}

        {sections.map((section: Section) => {
          const stats = sectionProgress(inspection, section);
          return (
            <ReportSection
              key={section.id}
              title={section.title}
              meta={
                stats.failed > 0 ? (
                  <Badge tone="fail">
                    <AlertIcon className="size-3" />
                    {stats.failed} failed
                  </Badge>
                ) : (
                  <Badge tone="pass">All clear</Badge>
                )
              }
            >
              <ul className="flex flex-col divide-y divide-ink-100">
                {section.questions.map((question: Question) => {
                  const response = getResponse(inspection, question.id);
                  if (!isScored(question)) {
                    return (
                      <li
                        key={question.id}
                        className="flex items-baseline justify-between gap-3 py-2.5 break-inside-avoid"
                      >
                        <span className="text-[14px] text-ink-700">{question.text}</span>
                        <span className="shrink-0 text-[14px] font-semibold text-ink-900 tabular-nums">
                          {response.value?.trim() ? `${response.value} ${question.unit ?? ''}` : '—'}
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={question.id} className="py-2.5 break-inside-avoid">
                      <div className="flex items-start gap-2.5">
                        <AnswerMark answer={response.answer} />
                        <p className="flex-1 text-[14px] leading-snug text-ink-800">
                          {question.text}
                        </p>
                      </div>
                      {response.note?.trim() ? (
                        <p
                          className={cx(
                            'mt-1.5 ml-7 rounded-lg p-2.5 text-[13px] leading-relaxed',
                            response.answer === 'no'
                              ? 'bg-fail-50 text-fail-700'
                              : 'bg-ink-50 text-ink-600',
                          )}
                        >
                          {response.note}
                        </p>
                      ) : null}
                      {response.photoIds.length > 0 ? (
                        <div className="mt-2 ml-7 grid grid-cols-3 gap-2">
                          {response.photoIds.map((photoId) => (
                            <ReportPhoto
                              key={photoId}
                              photoId={photoId}
                              onOpen={() => setViewingPhoto(photoId)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </ReportSection>
          );
        })}

        {inspection.reopenings?.length ? (
          <ReportSection
            title="Reopened after signing"
            meta={<Badge tone="warn">{inspection.reopenings.length}</Badge>}
          >
            <ul className="flex flex-col divide-y divide-ink-100">
              {inspection.reopenings.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="py-2.5 break-inside-avoid first:pt-0">
                  <p className="text-[14px] leading-snug text-ink-800">{entry.reason}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {formatDateTime(entry.at)}
                    {entry.by ? ` · ${entry.by}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </ReportSection>
        ) : null}

        <ReportSection title="Signatures">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SignatureBlock label="Inspector" record={inspection.inspectorSignature} />
            <SignatureBlock label="Customer" record={inspection.customerSignature} />
          </div>
        </ReportSection>

        <div className="mt-6 flex flex-col gap-2 no-print">
          <Button variant="secondary" block onClick={() => window.print()}>
            <PrinterIcon className="size-5" />
            Print / save as PDF
          </Button>
          <Button variant="secondary" block onClick={exportJson}>
            <ShareIcon className="size-5" />
            Export data (JSON)
          </Button>
          {completed ? (
            <Button variant="ghost" block onClick={reopen}>
              <PenIcon className="size-4" />
              Reopen for editing
            </Button>
          ) : (
            <Link to={`/inspections/${inspection.id}`}>
              <Button block>Continue inspection</Button>
            </Link>
          )}
        </div>
      </Screen>

      {viewingPhoto ? (
        <PhotoViewer
          photoId={viewingPhoto}
          onClose={() => setViewingPhoto(null)}
          // A signed report is a record. Marking up a photo inside one would
          // change what a customer was handed without leaving any trace.
          editable={!completed}
        />
      ) : null}
    </>
  );
}

function ReportSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 break-inside-avoid">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h3 className="text-[13px] font-bold tracking-wide text-ink-500 uppercase">{title}</h3>
        {meta}
      </div>
      <Card className="p-4 print-plain">{children}</Card>
    </section>
  );
}

function AnswerMark({ answer }: { answer: Answer | null }) {
  if (answer === 'yes') {
    return (
      <span className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-pass-500 text-white">
        <CheckIcon className="size-3" strokeWidth={4} />
      </span>
    );
  }
  if (answer === 'no') {
    return (
      <span className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-fail-500 text-white">
        <XIcon className="size-3" strokeWidth={4} />
      </span>
    );
  }
  if (answer === 'na') {
    return (
      <span className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-ink-400 text-white">
        <MinusIcon className="size-3" strokeWidth={4} />
      </span>
    );
  }
  return (
    <span
      className="mt-0.5 size-4.5 shrink-0 rounded-full border-2 border-dashed border-warn-500"
      title="Unanswered"
    />
  );
}

function ReportPhoto({ photoId, onOpen }: { photoId: string; onOpen: () => void }) {
  const { url, annotations } = usePhoto(photoId);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="aspect-4/3 overflow-hidden rounded-lg border border-ink-200 bg-ink-100"
    >
      {url ? (
        <AnnotatedPhoto src={url} annotations={annotations} className="size-full" />
      ) : null}
    </button>
  );
}

function SignatureBlock({ label, record }: { label: string; record?: SignatureRecord }) {
  return (
    <div className="break-inside-avoid">
      <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">{label}</p>
      {record ? (
        <>
          <img
            src={record.dataUrl}
            alt={`${label} signature`}
            className="mt-1 h-20 w-full border-b border-ink-300 object-contain"
          />
          <p className="mt-1 text-[14px] font-semibold text-ink-900">{record.name}</p>
          <p className="text-xs text-ink-500">{formatDateTime(record.signedAt)}</p>
        </>
      ) : (
        <p className="mt-6 border-b border-ink-300 pb-1 text-[13px] text-ink-400">Not signed</p>
      )}
    </div>
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
