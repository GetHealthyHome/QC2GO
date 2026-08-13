import { newElementId } from './checklist';
import { isSupabaseConfigured, supabase } from './supabase';
import type { Question } from './types';

/**
 * Asking the server to propose checkpoints for one section.
 *
 * Everything that decides whether a suggestion may be shown lives on the
 * server, in `supabase/functions/ai-checkpoints/restraint.ts` — chiefly that a
 * suggestion may say what to check but not what passes. This file is the
 * asking, and the conversion of what comes back into the same `Question` shape
 * a hand-typed checkpoint has.
 *
 * Nothing here writes to a checklist. A suggestion becomes a checkpoint when an
 * admin presses Add on it, one at a time, and the unsaved draft it lands in is
 * the same one every other edit goes through — so it is still theirs to reword,
 * mark critical, or delete before anything is saved.
 */

/**
 * The floor the server enforces, repeated so the button can be disabled rather
 * than pressed into a refusal. `restraint.ts` is the authority; this is the
 * courtesy.
 */
const MIN_BRIEF = 8;

/** What the server proposes, before an admin has agreed to any of it. */
export interface Suggestion {
  text: string;
  help?: string;
  kind: 'yesno' | 'measurement' | 'text';
  unit?: string;
}

export interface Discarded {
  text: string;
  reason: string;
}

export type SuggestResult =
  | { ok: true; suggestions: Suggestion[]; refused: Discarded[]; note?: string }
  | { ok: false; error: string };

/**
 * Whether the affordance should be there at all.
 *
 * Local mode has no server to ask, and somebody who cannot edit the checklist
 * has nothing to do with a suggestion for it.
 */
export function suggestionsPossible(isAdmin: boolean): boolean {
  return isAdmin && isSupabaseConfigured;
}

/** Whether there is enough of a description to be worth spending a call on. */
export function canSuggest(brief: string, isAdmin: boolean): boolean {
  if (!suggestionsPossible(isAdmin)) return false;
  return brief.trim().length >= MIN_BRIEF;
}

/**
 * The checkpoints already in the section, sent so the server can refuse to
 * propose one of them again. Empty questions are skipped — a blank row the
 * admin has not filled in yet is not a checkpoint the section covers.
 */
export function existingTexts(questions: Question[]): string[] {
  return questions.map((question) => question.text.trim()).filter((text) => text.length > 0);
}

export async function suggestCheckpoints(
  brief: string,
  existing: string[],
): Promise<SuggestResult> {
  if (!supabase) return { ok: false, error: 'This deployment has no backend to ask.' };

  const { data, error } = await supabase.functions.invoke('ai-checkpoints', {
    body: { brief, existing },
  });

  if (error) {
    // Every refusal from the function is a readable sentence with a status on
    // it; the client library reports only that something failed, so dig the
    // real message out of the response before falling back.
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        if (body?.error) return { ok: false, error: String(body.error) };
      } catch {
        // Fall through.
      }
    }
    return { ok: false, error: error.message || 'Could not reach the server.' };
  }

  if (data?.error) return { ok: false, error: String(data.error) };
  if (!Array.isArray(data?.suggestions)) {
    return { ok: false, error: 'Nothing usable came back. Your section is unchanged.' };
  }

  return {
    ok: true,
    suggestions: data.suggestions as Suggestion[],
    refused: Array.isArray(data.refused) ? (data.refused as Discarded[]) : [],
    note: typeof data.note === 'string' ? data.note : undefined,
  };
}

/**
 * A suggestion an admin accepted, as an ordinary checkpoint.
 *
 * It gets a fresh id here rather than on the server, for the same reason every
 * other checkpoint does: ids only have to be unique within one checklist, and
 * the server has never seen the checklist.
 *
 * Note what is *not* carried across. `critical`, `photoOnPass` and
 * `informational` are company policy — whether failing this item stops a
 * sign-off outright is a decision with a person behind it, and it is one tap
 * away in the editor once the checkpoint is there.
 */
export function asQuestion(suggestion: Suggestion): Question {
  return {
    id: newElementId('q'),
    text: suggestion.text,
    kind: suggestion.kind,
    ...(suggestion.help ? { help: suggestion.help } : {}),
    ...(suggestion.kind === 'measurement' && suggestion.unit ? { unit: suggestion.unit } : {}),
  };
}
