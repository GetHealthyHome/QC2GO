/**
 * Whether a tidied-up deficiency note may be shown to the person who wrote it.
 *
 * A deficiency note goes to the customer more or less verbatim: it appears in
 * the report, in the punch list, and on the work order somebody acts on. So the
 * failure that matters here is not a clumsy sentence. It is the model quietly
 * changing what was claimed —
 *
 *     "no condensate trap"  ->  "condensate trap installed incorrectly"
 *
 * — which reads better, is grammatical, and is a different allegation about
 * somebody's work. Nobody proof-reads a suggestion they asked for on the
 * grounds that it would read better.
 *
 * Two rules do most of the work, and both are testable without a model:
 *
 *  1. **The facts must be the same, in the same order.** Every number,
 *     measurement, rating and serial in the original has to survive into the
 *     suggestion, the suggestion may not contain one the original did not, and
 *     they may not swap places. Order is checked because the dangerous edit is
 *     often a swap — "R-13 batts in a wall that calls for R-19" reversed has
 *     exactly the same numbers in it.
 *  2. **The polarity must not flip.** If the original denies something and the
 *     suggestion does not, or the other way round, it is a different claim.
 *
 * Both are cheap, blunt and wrong in one direction only: they refuse rewrites
 * that were in fact fine — a date rendered as prose, a range written out in
 * words, a sentence that moves the measurement in front of the thing measured.
 * That is the correct direction to be wrong in. The cost of a refusal is the
 * inspector keeps the sentence they already typed.
 *
 * ## What this does not catch
 *
 * A rewrite can change meaning without touching a number or a negative: "the
 * flue is loose" to "the flue is unsafe" passes everything here. That is why
 * the suggestion is never applied automatically — see `ai-scribe/index.ts`. The
 * inspector reads it and presses Use, or does not.
 */

import { facts } from '../_shared/facts.ts';

/**
 * Re-exported because this file is the one the scribe tests bundle, and because
 * "which numbers may not change" is part of what fidelity means here even
 * though `ai-checkpoints` needs the same answer.
 */
export { facts };

export type Verdict =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; status: number; reason: string };

/**
 * Below this there is nothing to tidy — only room to invent. "no trap" cleaned
 * up is either "no trap" or something the inspector did not say.
 */
export const MIN_CHARS = 12;

/** Above this it is not a note, and one call should not cost what it would. */
export const MAX_CHARS = 4000;

/**
 * The instruction the model is given, kept here rather than in the handler so
 * that what it forbids is reviewed alongside the checks that enforce it.
 *
 * It asks for less than it could. A rewrite that reorganises the observation
 * into a tidy paragraph is where invented detail comes from; a rewrite that
 * fixes spelling, punctuation and the sentence's shape is what somebody typing
 * on a phone in a crawlspace actually needs.
 */
export const SYSTEM_PROMPT = [
  'You clean up a single note written by a building inspector on a phone, on site.',
  '',
  'The note describes something wrong with a house that the homeowner will read.',
  'Fix spelling, punctuation, capitalisation and sentence structure. Expand an',
  'abbreviation only where the meaning is beyond doubt. Keep the trade terms the',
  'inspector used — they are correct and the customer is used to them.',
  '',
  'Do not add any fact that is not already in the note. Do not add a cause, a',
  'severity, a location, a measurement, a recommendation or a next step that the',
  'inspector did not write. Do not soften or sharpen what the note alleges: if it',
  'says something is absent, the result must say it is absent, not that it is',
  'wrong or poorly done. Every number, measurement, model number and serial must',
  'appear unchanged.',
  '',
  'If the note is already clear, return it as it is. Return the note text only.',
].join('\n');

/**
 * Whether a note is worth sending at all.
 *
 * Runs on the server rather than only in the browser: the button is the polite
 * version of this rule, and a stale client is not a reason to spend a call on
 * eleven characters.
 */
export function acceptNote(raw: unknown): { ok: true; note: string } | { ok: false; status: number; reason: string } {
  if (typeof raw !== 'string') {
    return { ok: false, status: 400, reason: 'No note was sent.' };
  }
  const note = raw.trim();
  if (note.length < MIN_CHARS) {
    return { ok: false, status: 422, reason: 'There is not enough here yet to tidy up.' };
  }
  if (note.length > MAX_CHARS) {
    return { ok: false, status: 422, reason: 'This note is too long to tidy up in one go.' };
  }
  return { ok: true, note };
}

/**
 * Whether what came back may be offered as a suggestion.
 *
 * Order matters: the shape checks are cheap and their failures are unambiguous,
 * so they run before the two that carry the meaning.
 */
export function acceptSuggestion(original: string, raw: unknown): Verdict {
  if (typeof raw !== 'string') {
    return { ok: false, status: 502, reason: 'Nothing usable came back. Your note is unchanged.' };
  }

  const suggestion = unwrap(raw);
  if (suggestion.length === 0) {
    return { ok: false, status: 502, reason: 'Nothing usable came back. Your note is unchanged.' };
  }

  // A tidy-up that is twice the length is not a tidy-up. The flat allowance on
  // top keeps short notes from being refused for gaining a clause of grammar.
  if (suggestion.length > Math.max(original.length * 2, original.length + 200)) {
    return { ok: false, status: 422, reason: 'The suggestion added more than it tidied, so it was discarded.' };
  }

  const before = facts(original);
  const after = facts(suggestion);

  const dropped = before.filter((fact) => !after.includes(fact));
  if (dropped.length > 0) {
    return {
      ok: false,
      status: 422,
      reason: `The suggestion lost something from the original (${describe(dropped)}), so it was discarded.`,
    };
  }

  const invented = after.filter((fact) => !before.includes(fact));
  if (invented.length > 0) {
    return {
      ok: false,
      status: 422,
      reason: `The suggestion added something you did not write (${describe(invented)}), so it was discarded.`,
    };
  }

  // Same facts, both lists deduplicated, so any difference now is a swap.
  if (before.some((fact, index) => after[index] !== fact)) {
    return {
      ok: false,
      status: 422,
      reason: 'The suggestion moved the measurements around, so it was discarded.',
    };
  }

  if (denies(original) !== denies(suggestion)) {
    return {
      ok: false,
      status: 422,
      reason: 'The suggestion changed what the note says is wrong, so it was discarded.',
    };
  }

  return { ok: true, text: suggestion, changed: suggestion !== original.trim() };
}

/**
 * Strips the wrapping a model puts round an answer when it is being helpful:
 * a code fence, or the whole thing in quotes. Both would be pasted into the
 * report verbatim.
 */
function unwrap(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();
  const quoted = text.match(/^"([\s\S]+)"$/) ?? text.match(/^'([\s\S]+)'$/);
  if (quoted) text = quoted[1].trim();
  return text;
}

function describe(facts: string[]): string {
  const shown = facts.slice(0, 3).join(', ');
  return facts.length > 3 ? `${shown} and ${facts.length - 3} more` : shown;
}

// ---------------------------------------------------------------------------
// Polarity
// ---------------------------------------------------------------------------

/**
 * Whether the note says something is absent, missing or not the case.
 *
 * Deliberately a yes-or-no about the whole note rather than a count. Counting
 * would refuse every rewrite that merges two negative sentences into one, which
 * is exactly the tidying this feature is for. The flip from one to none, or
 * none to one, is the failure worth catching: it is the difference between
 * "there is no trap" and "the trap is wrong".
 */
export function denies(text: string): boolean {
  const words = text
    .toLowerCase()
    // So that "isn’t" counts the same as "isn't".
    .replace(/[‘’]/g, "'")
    // "model no. 4472" and "serial no 88b" are abbreviations for number, and
    // they are common enough in this field that reading them as denials would
    // refuse a good rewrite of half the notes that mention a part.
    .replace(/\bnos?\.(?=\s|$)/g, ' ')
    .replace(/\bnos?\.?(?=\s*[#\d])/g, ' ');
  return /\b(no|not|none|nothing|never|without|missing|absent|lacks?|lacking|failed|fails|fail|isn't|wasn't|aren't|weren't|doesn't|didn't|don't|hasn't|haven't|can't|cannot|couldn't|won't|unable|neither|nor)\b/.test(
    words,
  );
}
