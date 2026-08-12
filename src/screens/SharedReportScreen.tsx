import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSharedReport, type SharedReport } from '../lib/shares';
import { formatDate, formatDateTime } from '../lib/inspection';
import type { Answer, Section } from '../lib/types';
import { AnnotatedPhoto } from '../components/AnnotatedPhoto';
import { Letterhead } from '../components/Letterhead';
import { Badge, Button, Card, Field, Screen, TextInput, cx } from '../components/ui';
import { AlertIcon, CheckIcon, MinusIcon, PrinterIcon, XIcon } from '../components/Icons';

/**
 * A finished report, read by somebody outside the company.
 *
 * The only screen in QC2GO reachable without an account. It holds no store, no
 * sync and no session: everything on it came from one call, and the server on
 * the other end decided what a holder of the link may see. That separation is
 * the point — this component could not disclose more than it was given even if
 * it tried.
 */
export function SharedReportScreen() {
  const { token } = useParams();
  const [report, setReport] = useState<SharedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [pending, setPending] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (code?: string) => {
      if (!token) return;
      setLoading(true);
      const result = await fetchSharedReport(token, code);
      if (result.report) {
        setReport(result.report);
        setError(null);
        setNeedsPasscode(false);
        setPending(false);
      } else {
        setError(result.error ?? 'This report could not be opened.');
        setNeedsPasscode(result.needsPasscode === true);
        setPending(result.pending === true);
      }
      setLoading(false);
    },
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !report) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600" />
      </div>
    );
  }

  if (needsPasscode) {
    return (
      <div className="safe-pt safe-pb flex min-h-screen flex-col justify-center bg-ink-900 px-5 py-10">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load(passcode);
          }}
          className="mx-auto w-full max-w-sm rounded-2xl bg-white p-5"
        >
          <h1 className="text-[17px] font-bold text-ink-900">This report needs a passcode</h1>
          <p className="mt-1 text-[13px] text-ink-600">
            It was sent separately from the link.
          </p>
          <Field label="Passcode" className="mt-4">
            <TextInput
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              autoFocus
            />
          </Field>
          {error && !loading ? (
            <p className="mt-2 rounded-lg bg-fail-50 px-3 py-2 text-[13px] font-medium text-fail-700">
              {error}
            </p>
          ) : null}
          <Button type="submit" block className="mt-3" disabled={loading || !passcode}>
            {loading ? 'Checking…' : 'Open report'}
          </Button>
        </form>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="safe-pt flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <AlertIcon className="size-8 text-ink-300" />
        {/*
          * A report mid-amendment is not a broken link, and heading it as one
          * would send the reader back to ask for a replacement they do not need.
          */}
        <h1 className="mt-3 text-lg font-bold text-ink-900">
          {pending ? 'This report is being updated' : 'This link cannot be opened'}
        </h1>
        <p className="mt-1 max-w-xs text-[14px] text-ink-500">{error}</p>
        {pending ? (
          <Button variant="secondary" className="mt-4" onClick={() => void load()}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  const inspection = report.inspection as {
    snapshot?: { templateName?: string; sections?: Section[] };
    responses?: Record<string, { answer?: Answer | null; note?: string; value?: string; photoIds?: string[] }>;
    sectionInstances?: Record<string, Array<{ id: string; label?: string }>>;
    info?: Record<string, string>;
    summaryNotes?: string;
    completedAt?: string;
    overallScore?: number;
    passFailStatus?: string;
    inspectorSignature?: { name: string; dataUrl: string; signedAt: string };
    customerSignature?: { name: string; dataUrl: string; signedAt: string };
  };

  const sections = inspection.snapshot?.sections ?? [];
  const photosByQuestion = new Map<string, SharedReport['photos']>();
  for (const photo of report.photos) {
    photosByQuestion.set(photo.questionId, [
      ...(photosByQuestion.get(photo.questionId) ?? []),
      photo,
    ]);
  }

  // The same expansion the app does, rebuilt from what was sent rather than
  // imported: this screen has no inspection record to hand to `expandSections`.
  const blocks: Array<{ section: Section; instanceId?: string; title: string; key: string }> = [];
  for (const section of sections) {
    if (!section.repeatable) {
      blocks.push({ section, title: section.title, key: section.id });
      continue;
    }
    (inspection.sectionInstances?.[section.id] ?? []).forEach((instance, index) => {
      const name = instance.label?.trim() || `${section.instanceNoun || 'Item'} ${index + 1}`;
      blocks.push({
        section,
        instanceId: instance.id,
        title: `${section.title} — ${name}`,
        key: `${section.id}#${instance.id}`,
      });
    });
  }

  const answerOf = (questionId: string, instanceId?: string) =>
    inspection.responses?.[instanceId ? `${questionId}#${instanceId}` : questionId];

  return (
    <Screen className="pb-10">
      <Letterhead
        logo={report.organization.logo}
        companyName={report.organization.name || 'QC2GO'}
        title={inspection.snapshot?.templateName ?? 'Inspection report'}
        meta={report.customer.address}
      />

      <Card className="p-4 print-plain">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg leading-tight font-bold text-ink-900">
              {report.customer.customerName}
            </h1>
            <p className="text-[13px] text-ink-500">
              {inspection.completedAt ? `Signed off ${formatDateTime(inspection.completedAt)}` : ''}
            </p>
          </div>
          {inspection.passFailStatus ? (
            <Badge tone={inspection.passFailStatus === 'PASS' ? 'pass' : inspection.passFailStatus === 'FAIL' ? 'fail' : 'warn'}>
              {inspection.passFailStatus.replace('_', ' ')}
              {typeof inspection.overallScore === 'number' ? ` · ${inspection.overallScore}%` : ''}
            </Badge>
          ) : null}
        </div>
      </Card>

      {inspection.summaryNotes ? (
        <Section title="Summary">
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink-700">
            {inspection.summaryNotes}
          </p>
        </Section>
      ) : null}

      {blocks.map((block) => (
        <Section key={block.key} title={block.title}>
          <ul className="flex flex-col divide-y divide-ink-100">
            {block.section.questions.map((question) => {
              const response = answerOf(question.id, block.instanceId);
              const photos = (response?.photoIds ?? []).flatMap(
                (id) => report.photos.filter((photo) => photo.id === id),
              );
              return (
                <li key={question.id} className="py-2.5 break-inside-avoid">
                  <div className="flex items-start gap-2.5">
                    <Mark answer={response?.answer ?? null} />
                    <p className="flex-1 text-[14px] leading-snug text-ink-800">{question.text}</p>
                    {response?.value && !question.scannable ? (
                      <span className="shrink-0 text-[14px] font-semibold text-ink-900 tabular-nums">
                        {response.value} {question.unit ?? ''}
                      </span>
                    ) : null}
                  </div>
                  {/* Serials get their own block rather than a cramped column:
                      this is what a homeowner needs for a warranty claim. */}
                  {question.scannable && response?.value?.trim() ? (
                    <p className="mt-1.5 ml-7 rounded-lg bg-ink-50 p-2.5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-ink-800">
                      {response.value.trim()}
                    </p>
                  ) : null}
                  {response?.note ? (
                    <p
                      className={cx(
                        'mt-1.5 ml-7 rounded-lg p-2.5 text-[13px] leading-relaxed',
                        response.answer === 'no' ? 'bg-fail-50 text-fail-700' : 'bg-ink-50 text-ink-600',
                      )}
                    >
                      {response.note}
                    </p>
                  ) : null}
                  {photos.length > 0 ? (
                    <div className="mt-2 ml-7 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {photos.map((photo) => (
                        <AnnotatedPhoto
                          key={photo.id}
                          src={photo.url}
                          annotations={photo.annotations as never}
                          className="aspect-4/3 overflow-hidden rounded-lg border border-ink-200"
                        />
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ))}

      <Section title="Signatures">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            ['Inspector', inspection.inspectorSignature],
            ['Customer', inspection.customerSignature],
          ].map(([label, record]) => (
            <div key={label as string} className="break-inside-avoid">
              <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">{label as string}</p>
              {record ? (
                <>
                  <img
                    src={(record as { dataUrl: string }).dataUrl}
                    alt=""
                    className="mt-1 h-20 w-full border-b border-ink-300 object-contain"
                  />
                  <p className="mt-1 text-[14px] font-semibold text-ink-900">
                    {(record as { name: string }).name}
                  </p>
                  <p className="text-xs text-ink-500">
                    {formatDate((record as { signedAt: string }).signedAt)}
                  </p>
                </>
              ) : (
                <p className="mt-6 border-b border-ink-300 pb-1 text-[13px] text-ink-400">Not signed</p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Button variant="secondary" block className="mt-6 no-print" onClick={() => window.print()}>
        <PrinterIcon className="size-5" />
        Print / save as PDF
      </Button>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="mb-2 px-1 text-[13px] font-bold tracking-wide text-ink-500 uppercase">{title}</h2>
      <Card className="p-4 print-plain">{children}</Card>
    </section>
  );
}

function Mark({ answer }: { answer: Answer | null }) {
  const shared = 'mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full text-white';
  if (answer === 'yes') return <span className={cx(shared, 'bg-pass-500')}><CheckIcon className="size-3" strokeWidth={4} /></span>;
  if (answer === 'no') return <span className={cx(shared, 'bg-fail-500')}><XIcon className="size-3" strokeWidth={4} /></span>;
  if (answer === 'na') return <span className={cx(shared, 'bg-ink-400')}><MinusIcon className="size-3" strokeWidth={4} /></span>;
  return <span className="mt-0.5 size-4.5 shrink-0 rounded-full border-2 border-dashed border-ink-200" />;
}
