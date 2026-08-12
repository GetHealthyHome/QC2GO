import { useState } from 'react';
import type { Answer, Inspection, Question, Response } from '../lib/types';
import { getResponse, isScored } from '../lib/inspection';
import { countCodes, mergeCodes, scanningSupported } from '../lib/barcode';
import { AddPhotoButton, PhotoThumb } from './Photos';
import { BarcodeScanner } from './BarcodeScanner';
import { AlertIcon, BarcodeIcon, CameraIcon, CheckIcon, MinusIcon, PenIcon, XIcon } from './Icons';
import { Badge, cx } from './ui';

/**
 * Where equipment serial and model numbers go.
 *
 * Until now they existed only as pixels in a photo of the data plate, which
 * makes them unsearchable, absent from the export and the webhook payload, and
 * useless for warranty registration without somebody squinting at an image.
 *
 * Typing is still first-class and always available. The camera is an
 * alternative to gloved thumbs, not a replacement for a field — a rained-on
 * label sometimes wins, and on a device with no decoder (every iPhone today)
 * the button is simply absent rather than present and broken.
 */
function SerialField({
  question,
  response,
  readOnly,
  onChange,
}: {
  question: Question;
  response: Response;
  readOnly?: boolean;
  onChange: (questionId: string, patch: Partial<Response>) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const value = response.value ?? '';
  const count = countCodes(value);

  return (
    <div className="mt-3 rounded-xl border border-ink-200 bg-ink-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-bold tracking-wide text-ink-500 uppercase">
          Serial / model numbers
        </p>
        {count > 0 ? <Badge tone="brand">{count}</Badge> : null}
      </div>
      <textarea
        value={value}
        disabled={readOnly}
        rows={Math.min(Math.max(count, 1), 6)}
        placeholder="One per line"
        onChange={(event) => onChange(question.id, { value: event.target.value })}
        className="mt-2 w-full resize-y rounded-xl border border-ink-200 bg-white px-3.5 py-3 font-mono text-[14px] text-ink-900 outline-none placeholder:font-sans placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
      {!readOnly && scanningSupported() ? (
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-brand-200 bg-white py-2.5 text-[14px] font-semibold text-brand-700 active:bg-brand-50"
        >
          <BarcodeIcon className="size-5" />
          Scan a code
        </button>
      ) : null}

      {scanning ? (
        <BarcodeScanner
          captured={count}
          onClose={() => setScanning(false)}
          onCode={(raw) => {
            const next = mergeCodes(response.value, raw);
            // Only write when something actually changed: the detect loop reads
            // the same plate several times a second, and an unchanged write is
            // a sync queue entry and a re-render for nothing.
            if (next !== response.value) onChange(question.id, { value: next });
          }}
        />
      ) : null}
    </div>
  );
}

const ANSWER_BUTTONS: Array<{
  value: Answer;
  label: string;
  Icon: typeof CheckIcon;
  selected: string;
  idle: string;
}> = [
  {
    value: 'yes',
    label: 'Yes',
    Icon: CheckIcon,
    selected: 'border-pass-600 bg-pass-500 text-white',
    idle: 'border-ink-200 bg-white text-ink-500 active:bg-pass-50 active:border-pass-500 active:text-pass-700',
  },
  {
    value: 'no',
    label: 'No',
    Icon: XIcon,
    selected: 'border-fail-600 bg-fail-500 text-white',
    idle: 'border-ink-200 bg-white text-ink-500 active:bg-fail-50 active:border-fail-500 active:text-fail-700',
  },
  {
    value: 'na',
    label: 'N/A',
    Icon: MinusIcon,
    selected: 'border-ink-600 bg-ink-600 text-white',
    idle: 'border-ink-200 bg-white text-ink-500 active:bg-ink-100',
  },
];

export function QuestionCard({
  index,
  question,
  instanceId,
  inspection,
  readOnly,
  highlight,
  onChange,
  onOpenPhoto,
}: {
  index: number;
  question: Question;
  /** Which instance of a repeatable section this card belongs to, if any. */
  instanceId?: string;
  inspection: Inspection;
  readOnly?: boolean;
  highlight?: boolean;
  onChange: (questionId: string, patch: Partial<Response>) => void;
  onOpenPhoto: (photoId: string) => void;
}) {
  const response = getResponse(inspection, question.id, instanceId);
  const [showOptional, setShowOptional] = useState(false);

  if (!isScored(question)) {
    return (
      <MeasurementCard
        index={index}
        question={question}
        response={response}
        readOnly={readOnly}
        onChange={onChange}
      />
    );
  }

  const failed = response.answer === 'no';
  const needsNote = failed && !response.note?.trim();
  const needsPhoto = failed && response.photoIds.length === 0;
  const wantsEvidence = response.answer === 'yes' && question.photoOnPass;
  const showExtras = showOptional || response.photoIds.length > 0 || Boolean(response.note?.trim());

  return (
    <article
      id={`q-${question.id}`}
      className={cx(
        'scroll-mt-40 overflow-hidden rounded-2xl border bg-white transition-colors break-inside-avoid',
        failed ? 'border-fail-300' : 'border-ink-200',
        highlight && 'ring-2 ring-brand-400 ring-offset-2',
      )}
    >
      <div className="p-4">
        <div className="flex gap-3">
          <span
            className={cx(
              'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold',
              failed ? 'bg-fail-100 text-fail-700' : 'bg-ink-100 text-ink-500',
            )}
          >
            {index}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-snug font-medium text-ink-900">{question.text}</p>
            {question.help ? (
              <p className="mt-1 text-[13px] leading-snug text-ink-500">{question.help}</p>
            ) : null}
            {question.critical || question.photoOnPass ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {question.critical ? (
                  <Badge tone="warn">
                    <AlertIcon className="size-3" />
                    Critical
                  </Badge>
                ) : null}
                {question.photoOnPass ? (
                  <Badge tone="brand">
                    <CameraIcon className="size-3" />
                    Photo for record
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-3 gap-2">
          {ANSWER_BUTTONS.map(({ value, label, Icon, selected, idle }) => {
            const isSelected = response.answer === value;
            return (
              <button
                key={value}
                type="button"
                disabled={readOnly}
                aria-pressed={isSelected}
                onClick={() =>
                  onChange(question.id, {
                    answer: isSelected ? null : value,
                    answeredAt: new Date().toISOString(),
                  })
                }
                className={cx(
                  'flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-[13px] font-bold transition-colors disabled:opacity-70',
                  isSelected ? selected : idle,
                )}
              >
                <Icon className="size-5" strokeWidth={3} />
                {label}
              </button>
            );
          })}
        </div>

        {question.scannable ? (
          <SerialField
            question={question}
            response={response}
            readOnly={readOnly}
            onChange={onChange}
          />
        ) : null}
      </div>

      {failed ? (
        <div className="border-t border-fail-200 bg-fail-50 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-fail-700">
            <AlertIcon className="size-4" />
            Deficiency — explanation and photo required
          </p>
          <textarea
            value={response.note ?? ''}
            disabled={readOnly}
            rows={3}
            placeholder="What is unsatisfactory, where is it, and what needs to happen to correct it?"
            onChange={(event) => onChange(question.id, { note: event.target.value })}
            className={cx(
              'w-full resize-y rounded-xl border bg-white px-3.5 py-3 text-[15px] text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-fail-100',
              needsNote ? 'border-fail-400' : 'border-ink-200',
            )}
          />
          {needsNote ? (
            <p className="mt-1 text-xs font-medium text-fail-700">An explanation is required.</p>
          ) : null}

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {response.photoIds.map((photoId) => (
              <PhotoThumb
                key={photoId}
                photoId={photoId}
                onOpen={() => onOpenPhoto(photoId)}
                onRemove={
                  readOnly
                    ? undefined
                    : () =>
                        onChange(question.id, {
                          photoIds: response.photoIds.filter((id) => id !== photoId),
                        })
                }
              />
            ))}
            {!readOnly ? (
              <AddPhotoButton
                inspectionId={inspection.id}
                questionId={question.id}
                tone="fail"
                label={response.photoIds.length ? 'Add' : 'Required'}
              />
            ) : null}
          </div>
          {needsPhoto ? (
            <p className="mt-1 text-xs font-medium text-fail-700">
              At least one photo of the deficiency is required.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          {wantsEvidence && response.photoIds.length === 0 && !readOnly ? (
            <div className="border-t border-brand-100 bg-brand-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-medium text-brand-800">
                  Attach the record photo for this item.
                </p>
                <AddPhotoButton
                  inspectionId={inspection.id}
                  questionId={question.id}
                  label="Photo"
                />
              </div>
            </div>
          ) : null}

          {showExtras ? (
            <div className="border-t border-ink-100 bg-ink-50 p-4">
              <textarea
                value={response.note ?? ''}
                disabled={readOnly}
                rows={2}
                placeholder="Optional note"
                onChange={(event) => onChange(question.id, { note: event.target.value })}
                className="w-full resize-y rounded-xl border border-ink-200 bg-white px-3.5 py-3 text-[15px] text-ink-900 outline-none placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {response.photoIds.map((photoId) => (
                  <PhotoThumb
                    key={photoId}
                    photoId={photoId}
                    onOpen={() => onOpenPhoto(photoId)}
                    onRemove={
                      readOnly
                        ? undefined
                        : () =>
                            onChange(question.id, {
                              photoIds: response.photoIds.filter((id) => id !== photoId),
                            })
                    }
                  />
                ))}
                {!readOnly ? (
                  <AddPhotoButton
                    inspectionId={inspection.id}
                    questionId={question.id}
                    label="Photo"
                  />
                ) : null}
              </div>
            </div>
          ) : (
            !readOnly && (
              <button
                type="button"
                onClick={() => setShowOptional(true)}
                className="flex w-full items-center justify-center gap-1.5 border-t border-ink-100 py-2.5 text-[13px] font-semibold text-ink-500 active:bg-ink-50"
              >
                <PenIcon className="size-3.5" />
                Add note or photo
              </button>
            )
          )}
        </>
      )}
    </article>
  );
}

function MeasurementCard({
  index,
  question,
  response,
  readOnly,
  onChange,
}: {
  index: number;
  question: Question;
  response: Response;
  readOnly?: boolean;
  onChange: (questionId: string, patch: Partial<Response>) => void;
}) {
  return (
    <article
      id={`q-${question.id}`}
      className="scroll-mt-40 rounded-2xl border border-ink-200 bg-white p-4 break-inside-avoid"
    >
      <div className="flex gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-[11px] font-bold text-brand-700">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-medium text-ink-900">{question.text}</p>
          {question.help ? (
            <p className="mt-1 text-[13px] leading-snug text-ink-500">{question.help}</p>
          ) : null}
          {/* Both write to `response.value`; only ever one of them is on screen,
              because two controls bound to one field is a way to lose an edit. */}
          {question.scannable ? (
            <SerialField
              question={question}
              response={response}
              readOnly={readOnly}
              onChange={onChange}
            />
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                inputMode={question.kind === 'measurement' ? 'decimal' : 'text'}
                value={response.value ?? ''}
                disabled={readOnly}
                placeholder="Record value"
                onChange={(event) => onChange(question.id, { value: event.target.value })}
                className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-3 text-[15px] outline-none placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              {question.unit ? (
                <span className="shrink-0 text-sm font-semibold text-ink-500">{question.unit}</span>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
