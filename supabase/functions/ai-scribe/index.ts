/**
 * ai-scribe — tidies up one deficiency note, on request.
 *
 * The first AI feature in QC2GO, and deliberately the smallest one: a single
 * note, cleaned up when somebody presses a button, offered as a suggestion they
 * accept or ignore. Nothing here writes to an inspection.
 *
 * It runs on a server rather than in the app for the ordinary reason — the API
 * key would otherwise be in the bundle, where a key is not a secret — and for a
 * second one that matters more. `fidelity.ts` decides whether what the model
 * returned may be shown at all, and that decision has to be somewhere a client
 * cannot skip. A phone that has not been reloaded in a fortnight is still
 * checked by whatever is deployed here today.
 *
 * ## What is deliberately not sent
 *
 * The checkpoint's own wording, and the customer's address. Both would help the
 * model write a fuller sentence, which is precisely the problem: every fact put
 * in front of it is a fact it can weave into a note the inspector did not
 * write, and the fidelity check cannot tell an imported fact from an invented
 * one. The note goes on its own.
 *
 * Secret:  GEMINI_API_KEY  (Project Settings -> Edge Functions -> Secrets)
 * Deploy:  supabase functions deploy ai-scribe
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { ask, hasApiKey } from '../_shared/gemini.ts';
import { MAX_CHARS, SYSTEM_PROMPT, acceptNote, acceptSuggestion } from './fidelity.ts';
import { json, preflight } from '../_shared/cors.ts';

/**
 * Structured output rather than trusting the last line of the prompt.
 *
 * "Return the note text only" is an instruction; this is a guarantee. Without
 * it the answer occasionally arrives wrapped in "Here is the tidied note:",
 * which the fidelity check would then have to treat as part of the note.
 */
const SCHEMA = {
  type: 'object',
  properties: { note: { type: 'string' } },
  required: ['note'],
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  // Asked here as well as inside `ask`, and before the meter, because the
  // allowance is claimed before the call. A deployment that never set the
  // secret would otherwise spend a company's whole daily allowance on a button
  // that was never going to work.
  if (!hasApiKey()) {
    return json({ error: 'Tidying up notes is not switched on for this deployment.' }, 503);
  }

  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    },
  );

  const { data: auth } = await asCaller.auth.getUser();
  if (!auth?.user) return json({ error: 'Sign in first.' }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send a JSON body.' }, 400);
  }

  const request_ = acceptNote(body.note);
  if (!request_.ok) return json({ error: request_.reason }, request_.status);

  // Claimed before the call, not after: the call is billed whether or not the
  // answer survives the fidelity check, so metering the successes only would
  // leave the expensive failure mode uncounted.
  const { data: granted, error: meterError } = await asCaller.rpc('ai_take', { p_kind: 'scribe' });
  if (meterError) return json({ error: meterError.message }, 500);
  if (granted !== true) {
    return json(
      { error: 'This company has used its AI allowance for today. It resets at midnight UTC.' },
      429,
    );
  }

  const answer = await ask<{ note?: unknown }>({
    system: SYSTEM_PROMPT,
    user: request_.note.slice(0, MAX_CHARS),
    schema: SCHEMA,
    // A tidied note cannot be much longer than the note, and the note is
    // capped. This is a backstop against paying for an essay, not a target.
    maxOutputTokens: 2048,
  });
  if (!answer.ok) {
    // Every one of these leaves the note alone, so say so rather than leaving
    // somebody wondering whether their text was touched.
    return json({ error: `${answer.reason} Your note is unchanged.` }, answer.status);
  }

  const verdict = acceptSuggestion(request_.note, answer.value.note);
  if (!verdict.ok) return json({ error: verdict.reason }, verdict.status);

  return json({ suggestion: verdict.text, changed: verdict.changed });
});
