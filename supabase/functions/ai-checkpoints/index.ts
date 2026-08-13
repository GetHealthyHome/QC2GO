/**
 * ai-checkpoints — proposes checkpoints for one section of a checklist.
 *
 * The second AI feature, and the first one that generates rather than edits.
 * An admin describes a section — "condensate and drainage on a ductless head"
 * — and gets back a handful of proposed checkpoints. Each is accepted or
 * discarded one at a time in the editor.
 *
 * **This endpoint writes nothing.** It has no service_role key and touches no
 * table but the meter. The section changes when an admin presses Add on a
 * suggestion, in the client, against the same store any hand-typed checkpoint
 * goes through. That is deliberate: a generated checkpoint has no original to
 * check it against, so the last check has to be a person who knows the
 * equipment, and there is no path here that bypasses them.
 *
 * `restraint.ts` decides what may be shown at all — chiefly that a suggestion
 * may say what to check but not what passes. It runs on the server for the
 * reason every gate in this codebase does: a phone that has not been reloaded
 * in a fortnight is still checked by what is deployed today.
 *
 * ## Who may ask
 *
 * Admins and owners only, checked here against the caller's own profile row
 * rather than anything in the request. Editing a checklist is already an admin
 * action in the app; an endpoint that spends the company's AI allowance should
 * not be the one place an inspector can reach past that.
 *
 * Secret:  GEMINI_API_KEY  (Project Settings -> Edge Functions -> Secrets)
 * Deploy:  supabase functions deploy ai-checkpoints
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { ask, hasApiKey } from '../_shared/gemini.ts';
import {
import { json, preflight } from '../_shared/cors.ts';
  MAX_HELP,
  MAX_SUGGESTIONS,
  MAX_TEXT,
  MAX_UNIT,
  SYSTEM_PROMPT,
  acceptBrief,
  existingKeys,
  sift,
} from './restraint.ts';

/**
 * The shape the answer must take.
 *
 * The caps are repeated here as well as enforced in `restraint.ts` so that an
 * over-long checkpoint is usually never generated rather than generated and
 * thrown away. The enforcement is what makes it safe; this is what makes it
 * cheap.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    checkpoints: {
      type: 'array',
      maxItems: MAX_SUGGESTIONS,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: MAX_TEXT },
          help: { type: 'string', maxLength: MAX_HELP },
          kind: { type: 'string', enum: ['yesno', 'measurement', 'text'] },
          unit: { type: 'string', maxLength: MAX_UNIT },
        },
        required: ['text', 'kind'],
      },
    },
  },
  required: ['checkpoints'],
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  // Before the meter, because the allowance is claimed before the call and a
  // deployment that never set the secret would otherwise spend all of it.
  if (!hasApiKey()) {
    return json({ error: 'Suggesting checkpoints is not switched on for this deployment.' }, 503);
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

  // Read through the caller's own token, so the role and company come from
  // their profile row and not from anything they sent.
  const { data: profile } = await asCaller
    .from('profiles')
    .select('role, org_id')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (!profile?.org_id) {
    return json({ error: 'This account is not part of a company.' }, 403);
  }
  if (profile.role !== 'owner' && profile.role !== 'admin') {
    return json({ error: 'Only an admin can change a checklist.' }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send a JSON body.' }, 400);
  }

  const brief = acceptBrief(body.brief);
  if (!brief.ok) return json({ error: brief.reason }, brief.status);

  const existing = existingKeys(body.existing);

  const { data: granted, error: meterError } = await asCaller.rpc('ai_take', {
    p_kind: 'checkpoints',
  });
  if (meterError) return json({ error: meterError.message }, 500);
  if (granted !== true) {
    return json(
      { error: 'This company has used its AI allowance for today. It resets at midnight UTC.' },
      429,
    );
  }

  const answer = await ask<{ checkpoints?: unknown }>({
    system: SYSTEM_PROMPT,
    user: [
      `Section to propose checkpoints for: ${brief.brief}`,
      '',
      existing.length > 0
        ? `The section already covers ${existing.length} checkpoint(s). Do not repeat them.`
        : 'The section is empty.',
    ].join('\n'),
    schema: SCHEMA,
    maxOutputTokens: 2048,
  });
  if (!answer.ok) {
    return json({ error: `${answer.reason} Nothing was added to your section.` }, answer.status);
  }

  const sifted = sift(brief.brief, existing, answer.value.checkpoints);
  if (sifted.kept.length === 0) {
    return json({
      suggestions: [],
      refused: sifted.refused,
      // An empty result with a reason attached, rather than an error: the admin
      // asked a reasonable question and got nothing usable back, which is worth
      // saying plainly so they can rephrase.
      note: sifted.refused.length > 0
        ? 'Everything suggested was discarded before you saw it.'
        : 'Nothing was suggested for that description.',
    });
  }

  return json({ suggestions: sifted.kept, refused: sifted.refused });
});
