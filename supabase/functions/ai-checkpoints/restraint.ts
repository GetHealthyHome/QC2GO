/**
 * What a suggested checkpoint may say before an admin is allowed to see it.
 *
 * `ai-scribe` had an original to check its answer against: the note the
 * inspector typed. Generation has nothing of the kind — that is the whole
 * difficulty the roadmap flags, and no amount of checking turns a proposed
 * checkpoint into one that a person with the equipment in front of them wrote.
 *
 * So this file does not try to decide whether a checkpoint is *right*. It
 * decides whether it is the model's place to say it at all.
 *
 * ## The failure this is built around
 *
 * Not a badly worded question. A threshold:
 *
 *     "Verify total external static pressure is below 0.5 in. w.c."
 *
 * That reads like the rest of the checklist, it is plausible, and on many
 * systems it is even roughly right. But it is a company standard, arriving in a
 * company's checklist with nobody's decision behind it, and the inspector who
 * meets it in the field will score somebody's work against it. The number is
 * the part the model has no standing to supply.
 *
 * The rule, therefore: **the model may propose what to check. It may not
 * propose what passes.** Any number in a suggestion that the admin did not put
 * in their own description is treated as invented, and the suggestion carrying
 * it is thrown away — using the same `facts()` that decides which numbers a
 * tidied note may not change, so the two features cannot drift apart on what
 * counts as a number.
 *
 * "Record the measured static pressure" survives. The sentence above does not.
 *
 * ## What this deliberately does not do
 *
 * It does not judge trade accuracy. A suggestion to check a component that this
 * equipment does not have will pass every rule here. That is why nothing is
 * written by this endpoint: each surviving suggestion is shown to an admin, who
 * accepts the ones they want one at a time, and the section is unchanged until
 * they do.
 */
import { facts } from '../_shared/facts.ts';

/** The three question kinds a checklist has. Mirrors `src/lib/types.ts`. */
export type Kind = 'yesno' | 'measurement' | 'text';

const KINDS: Kind[] = ['yesno', 'measurement', 'text'];

export interface Proposal {
  text: string;
  help?: string;
  kind: Kind;
  unit?: string;
}

export interface Refusal {
  /** What was proposed, so the count shown to an admin is not a mystery. */
  text: string;
  reason: string;
}

/** Below this there is not enough of a description to propose anything from. */
export const MIN_BRIEF = 8;

/** Above this it is not a description of a section, it is the section. */
export const MAX_BRIEF = 400;

/**
 * How many come back at most.
 *
 * Six is about as many as somebody will actually read one at a time before
 * they start accepting them in a batch without looking, which is the behaviour
 * this whole design exists to avoid.
 */
export const MAX_SUGGESTIONS = 6;

/** A checkpoint is a question, not a paragraph. */
export const MAX_TEXT = 160;

/** The "what good looks like" line under it. */
export const MAX_HELP = 240;

/** "in. w.c.", "°F", "CFM". */
export const MAX_UNIT = 16;

/**
 * The instruction the model is given, kept beside the checks that enforce it so
 * that loosening one means looking at the other.
 */
export const SYSTEM_PROMPT = [
  'You propose quality-control checkpoints for a residential HVAC and building',
  'performance contractor. An admin describes one section of a checklist; you',
  'suggest the checkpoints that belong in it.',
  '',
  'Each checkpoint is a single thing an inspector confirms while standing in',
  'front of the equipment. Write it as a question or a short instruction, in the',
  'plain trade language a working inspector uses.',
  '',
  'Do not state a threshold, tolerance, limit, rating or target value. Do not',
  'write "verify X is below N" or "confirm at least N" — the company sets its',
  'own standards and you have not seen them. Ask for the reading to be recorded',
  'instead. Do not invent model numbers, part numbers or code references.',
  '',
  'Use no number at all unless the description you were given contains it.',
  '',
  'Propose only checkpoints that are not already in the section you were shown.',
].join('\n');

export type BriefResult =
  | { ok: true; brief: string }
  | { ok: false; status: number; reason: string };

/**
 * Whether a description is worth spending a call on.
 *
 * Enforced here rather than only in the browser for the same reason the note
 * floor is: the disabled button is the courtesy, this is the rule.
 */
export function acceptBrief(raw: unknown): BriefResult {
  if (typeof raw !== 'string') {
    return { ok: false, status: 400, reason: 'No description was sent.' };
  }
  const brief = raw.trim();
  if (brief.length < MIN_BRIEF) {
    return { ok: false, status: 422, reason: 'Describe the section in a little more detail first.' };
  }
  if (brief.length > MAX_BRIEF) {
    return { ok: false, status: 422, reason: 'That description is too long — a sentence or two is enough.' };
  }
  return { ok: true, brief };
}

/**
 * The checkpoints already in the section, normalised for comparison.
 *
 * Sent by the client and trusted only to make suggestions *fewer*: the worst a
 * wrong list can do is discard a proposal that would have been fine.
 */
export function existingKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map(key)
    .filter((entry) => entry.length > 0);
}

/**
 * Compared on significant words rather than characters, so that "Is the
 * condensate trap primed?" and "Verify the trap is primed" are recognised as
 * the same checkpoint asked twice.
 *
 * Three things are thrown away before comparing: punctuation, the words every
 * checkpoint contains ("confirm", "verify", "the"), and the end of each
 * remaining word. The last one is crude on purpose — "sloped", "slopes" and
 * "slope" all become "slop", which is not a word but is the same word three
 * times, and that is the only question being asked here.
 */
function key(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOP_WORDS.includes(word))
    .map(stem)
    .sort()
    .join(' ');
}

/**
 * Enough of a stemmer to see through the difference between how two people
 * write down the same check. Not enough to be one.
 */
function stem(word: string): string {
  let stemmed = word;
  if (stemmed.length > 4 && stemmed.endsWith('ing')) stemmed = stemmed.slice(0, -3);
  else if (stemmed.length > 4 && stemmed.endsWith('ed')) stemmed = stemmed.slice(0, -2);
  else if (stemmed.length > 3 && stemmed.endsWith('s') && !stemmed.endsWith('ss')) {
    stemmed = stemmed.slice(0, -1);
  }
  if (stemmed.length > 3 && stemmed.endsWith('e')) stemmed = stemmed.slice(0, -1);
  return stemmed;
}

/**
 * Whether this checkpoint is one the section already asks.
 *
 * Containment rather than equality: "verify the trap is primed" is every
 * significant word of an existing "is the condensate trap primed?", minus the
 * one that says which trap. Treating that as new gets the same check asked
 * twice in one section, which is how a checklist stops being read.
 *
 * Two words is the floor for a containment match, because a single shared word
 * is a subject, not a duplicate. It is still blunt, and it will occasionally
 * refuse a genuinely narrower check — but the cost of that is an admin typing
 * a checkpoint themselves, which is what they were doing before this feature
 * existed.
 */
function duplicates(candidate: string, seen: string[]): boolean {
  const words = candidate.split(' ').filter(Boolean);
  if (words.length === 0) return false;

  return seen.some((entry) => {
    const other = entry.split(' ').filter(Boolean);
    const [smaller, larger] = words.length <= other.length ? [words, other] : [other, words];
    if (smaller.length < 2) return smaller.length === larger.length && smaller[0] === larger[0];
    return smaller.every((word) => larger.includes(word));
  });
}

const STOP_WORDS = [
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'that', 'this',
  'it', 'its', 'as', 'by', 'from', 'has', 'have', 'had', 'does', 'do', 'did',
  'confirm', 'verify', 'check', 'ensure', 'record', 'inspect', 'any', 'all',
];

export interface Sifted {
  kept: Proposal[];
  refused: Refusal[];
}

/**
 * Sifts what came back into what an admin may be shown and what was thrown out.
 *
 * Returns both rather than only the survivors. A feature that silently
 * discarded half of what it produced would look like a model that had run out
 * of ideas, and the admin would press it again.
 */
export function sift(brief: string, existing: string[], raw: unknown): Sifted {
  const kept: Proposal[] = [];
  const refused: Refusal[] = [];

  if (!Array.isArray(raw)) return { kept, refused };

  // Everything the admin's own description licensed. A number they wrote is a
  // number they chose, and a suggestion may repeat it.
  const allowed = facts(brief);
  const seen = [...existing];

  for (const entry of raw) {
    if (kept.length >= MAX_SUGGESTIONS) break;
    if (!entry || typeof entry !== 'object') continue;

    const candidate = entry as Record<string, unknown>;
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
    if (text.length === 0 || text.length > MAX_TEXT) continue;

    const help =
      typeof candidate.help === 'string' && candidate.help.trim().length > 0
        ? candidate.help.trim().slice(0, MAX_HELP)
        : undefined;

    // A checkpoint's kind decides how it is answered and scored. An
    // unrecognised one is not worth guessing at.
    const kind: Kind = KINDS.includes(candidate.kind as Kind) ? (candidate.kind as Kind) : 'yesno';

    // A unit on a yes/no question is meaningless, and would render as a stray
    // label beside an answer that has no value to label.
    const unit =
      kind === 'measurement' && typeof candidate.unit === 'string' && candidate.unit.trim().length > 0
        ? candidate.unit.trim().slice(0, MAX_UNIT)
        : undefined;

    // `critical`, `photoOnPass` and `informational` are never read, whatever
    // the model sent. Whether failing an item blocks sign-off outright is a
    // company's policy decision, and an admin makes it in the editor after
    // accepting the checkpoint — not something that arrives switched on.

    const invented = facts(`${text} ${help ?? ''}`).filter((fact) => !allowed.includes(fact));
    if (invented.length > 0) {
      refused.push({
        text,
        reason: `sets a value nobody asked for (${invented.slice(0, 3).join(', ')})`,
      });
      continue;
    }

    const identity = key(text);
    if (identity.length === 0) continue;
    if (duplicates(identity, seen)) {
      refused.push({ text, reason: 'is already in this section' });
      continue;
    }

    seen.push(identity);
    kept.push({ text, kind, ...(help ? { help } : {}), ...(unit ? { unit } : {}) });
  }

  return { kept, refused };
}
