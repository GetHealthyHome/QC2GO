/**
 * "Suggest checkpoints" — the second place a model is asked for something, and
 * the first where what it produces has no original to be checked against.
 *
 * A generated checkpoint is a harder problem than a tidied note, and the shape
 * of this component is the answer to it. There is no "add all". Each suggestion
 * is added on its own, by somebody who can see it, into a draft that still has
 * to be saved. The server has already thrown away anything that tried to state
 * a threshold — see `ai-checkpoints/restraint.ts`, which lets a suggestion say
 * what to check but not what passes — and how many it threw away is shown
 * rather than hidden, because a silent gate looks like a model with no ideas
 * and gets pressed again.
 *
 * In local mode the affordance is absent entirely rather than present and
 * failing: there is no server to ask.
 *
 * ## Two callers, one panel
 *
 * The section editor lets an admin describe the section in its own words, so it
 * passes `onBriefChange` and gets a textarea. The new-checklist form has already
 * asked for a name and a description and should not ask a third time, so it
 * passes a brief built from those and no setter — the panel then shows what it
 * is about to send rather than inviting an edit. Showing it either way matters:
 * what comes back is only as good as the description, and an admin who cannot
 * see what was asked cannot tell a bad answer from a bad question.
 */
import { useState } from 'react';
import {
  type Suggestion,
  asQuestion,
  canSuggest,
  suggestCheckpoints,
  suggestionsPossible,
} from '../lib/checkpoints';
import type { Question } from '../lib/types';
import { AutoTextarea } from './ui';
import { SparkleIcon } from './Icons';

export function SuggestCheckpoints({
  brief,
  onBriefChange,
  existing,
  isAdmin,
  intro,
  onAdd,
}: {
  brief: string;
  /** Omit to show the brief read-only, for a caller that derived it. */
  onBriefChange?: (brief: string) => void;
  /** Checkpoints already written, so the server can refuse to repeat them. */
  existing: string[];
  isAdmin: boolean;
  intro: string;
  onAdd: (question: Question) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  if (!suggestionsPossible(isAdmin)) return null;

  async function run() {
    setBusy(true);
    setMessage(null);
    setSuggestions(null);
    const result = await suggestCheckpoints(brief.trim(), existing);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setSuggestions(result.suggestions);
    if (result.suggestions.length === 0) {
      setMessage(result.note ?? 'Nothing was suggested for that description.');
      return;
    }
    if (result.refused.length > 0) {
      // Said plainly. The commonest reason is a suggestion that named its own
      // pass/fail number, and an admin who knows that is an admin who can
      // decide whether the ones that survived are worth having.
      setMessage(
        `${result.refused.length} more ${result.refused.length === 1 ? 'was' : 'were'} discarded before you saw ${result.refused.length === 1 ? 'it' : 'them'} — ${result.refused[0].reason}.`,
      );
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 py-2.5 text-[13px] font-semibold text-ink-600 active:bg-ink-100"
      >
        <SparkleIcon className="size-4" />
        Suggest checkpoints
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-brand-200 bg-white p-3">
      <p className="text-[12px] font-bold tracking-wide text-brand-700 uppercase">
        Suggest checkpoints
      </p>
      <p className="mt-1 text-[13px] text-ink-500">{intro}</p>

      {onBriefChange ? (
        <AutoTextarea
          value={brief}
          className="mt-2 text-[14px]"
          placeholder="e.g. condensate and drainage on a ductless head"
          onChange={(event) => onBriefChange(event.target.value)}
        />
      ) : (
        <p className="mt-2 rounded-lg bg-ink-50 px-3 py-2 text-[13px] leading-snug text-ink-700">
          {brief.trim() || 'Nothing to go on yet.'}
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy || !canSuggest(brief, isAdmin)}
          onClick={() => void run()}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50 active:bg-brand-700"
        >
          {busy ? 'Thinking…' : 'Suggest'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setSuggestions(null);
            setMessage(null);
          }}
          className="rounded-lg border border-ink-200 px-3 py-1.5 text-[13px] font-semibold text-ink-700 active:bg-ink-100"
        >
          Done
        </button>
      </div>

      {message ? <p className="mt-2 text-[13px] text-ink-500">{message}</p> : null}

      {suggestions && suggestions.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {suggestions.map((suggestion, position) => (
            <div
              key={`${suggestion.text}-${position}`}
              className="rounded-lg border border-ink-200 p-2.5"
            >
              <p className="text-[14px] leading-snug text-ink-900">{suggestion.text}</p>
              {suggestion.help ? (
                <p className="mt-1 text-[13px] text-ink-500">{suggestion.help}</p>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onAdd(asQuestion(suggestion));
                    setSuggestions((current) =>
                      (current ?? []).filter((_, i) => i !== position),
                    );
                  }}
                  className="rounded-lg bg-ink-900 px-3 py-1.5 text-[13px] font-semibold text-white active:bg-ink-700"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSuggestions((current) => (current ?? []).filter((_, i) => i !== position))
                  }
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-[13px] font-semibold text-ink-700 active:bg-ink-100"
                >
                  Discard
                </button>
                <span className="ml-auto text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                  {suggestion.kind === 'measurement'
                    ? (suggestion.unit ?? 'Measurement')
                    : suggestion.kind === 'text'
                      ? 'Text'
                      : 'Yes / No'}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
