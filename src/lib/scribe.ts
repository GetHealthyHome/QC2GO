import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Asking the server to tidy up one deficiency note.
 *
 * Everything that decides whether a suggestion is safe to show lives on the
 * server, in `supabase/functions/ai-scribe/fidelity.ts`. This file is the
 * asking, plus the two conditions worth checking before spending a call: is
 * there a backend at all, and is there enough note to be worth it.
 *
 * The suggestion is never applied here. It comes back, it is shown next to what
 * the inspector wrote, and they choose. A note that quietly rewrote itself
 * would be a note nobody proof-read.
 */

/**
 * The floor the server enforces, repeated here so the button can be disabled
 * rather than pressed into a refusal. `fidelity.ts` is the authority; this is
 * the courtesy.
 */
const MIN_CHARS = 12;

export type TidyResult =
  | { ok: true; suggestion: string; changed: boolean }
  | { ok: false; error: string };

/**
 * Whether the button should be there at all.
 *
 * Local mode has no server to ask, and an inspection that is signed is a record
 * — its wording is what somebody put their name to.
 */
export function canTidy(note: string | undefined, readOnly: boolean): boolean {
  if (readOnly || !isSupabaseConfigured) return false;
  return (note ?? '').trim().length >= MIN_CHARS;
}

export async function tidyNote(note: string): Promise<TidyResult> {
  if (!supabase) return { ok: false, error: 'This deployment has no backend to ask.' };

  const { data, error } = await supabase.functions.invoke('ai-scribe', { body: { note } });

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
  if (typeof data?.suggestion !== 'string') {
    return { ok: false, error: 'Nothing usable came back. Your note is unchanged.' };
  }

  return { ok: true, suggestion: data.suggestion, changed: data.changed === true };
}
