/**
 * The one place QC2GO talks to a model.
 *
 * Both AI features — tidying a note, suggesting checkpoints — come through
 * here, for two reasons that are easy to lose once there are three.
 *
 * The first is the key. It is read in exactly one function in this codebase, so
 * moving to a different Google AI Studio account is a secret being changed in
 * the Supabase dashboard and nothing else. A key read in four places is a key
 * that gets rotated in three of them.
 *
 * The second is that every failure a model call has — no key, a blocked
 * prompt, a truncated answer, a body that is not the JSON it promised — has to
 * become a sentence somebody standing in a crawlspace can act on. Left to each
 * caller, that is four sets of error handling and four chances to return a 500
 * that reads like a bug when the truth is "nobody has switched this on yet".
 *
 * Secret:  GEMINI_API_KEY  (Project Settings -> Edge Functions -> Secrets)
 */
import { GoogleGenAI } from 'npm:@google/genai';
import { type ModelResult, interpret } from './reply.ts';

export type { ModelResult };

/**
 * Flash rather than Pro, deliberately.
 *
 * Neither thing asked of it here is hard: copy-edit one sentence, propose a
 * handful of checkpoints in a trade the model already knows. What both need is
 * to come back before somebody on a phone decides the app has hung. The
 * expensive model would write more, and writing more is the failure mode both
 * gates exist to catch.
 */
export const MODEL = 'gemini-3.6-flash';

export interface ModelRequest {
  /** Standing instruction — what the model is for, and what it may not do. */
  system: string;
  /** The one thing being asked about. */
  user: string;
  /**
   * The shape the answer must take.
   *
   * A schema rather than an instruction to return JSON. "Return only the note"
   * is a request the model usually honours and occasionally answers with "Here
   * is the tidied note:" in front of, which the caller would then have to treat
   * as part of the note.
   *
   * Note for anyone extending this: Gemini's schema dialect is a subset, and
   * `additionalProperties` is not in it. Sending one is rejected outright
   * rather than ignored.
   */
  schema: Record<string, unknown>;
  /** A backstop against paying for an essay, not a target. */
  maxOutputTokens: number;
}

/** Whether this deployment can call a model at all. */
export function hasApiKey(): boolean {
  return Boolean(Deno.env.get('GEMINI_API_KEY'));
}

/**
 * Asks the model, and returns either parsed JSON matching the schema or a
 * refusal with a status and a sentence.
 *
 * Never throws. A caller that has already claimed a metered call should not
 * also have to guard against this one exploding.
 */
export async function ask<T>(request: ModelRequest): Promise<ModelResult<T>> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    // A deployment without the secret is a deployment where this feature is
    // off. Saying so is better than a 500 that reads like a bug.
    return { ok: false, status: 503, reason: 'This deployment has not switched on its AI features.' };
  }

  let response;
  try {
    response = await new GoogleGenAI({ apiKey }).models.generateContent({
      model: MODEL,
      contents: request.user,
      config: {
        systemInstruction: request.system,
        responseMimeType: 'application/json',
        responseSchema: request.schema,
        maxOutputTokens: request.maxOutputTokens,
        // Nothing here wants variety. Two inspectors tidying the same note
        // should get the same sentence, and a suggestion that changes each
        // time it is asked for is one nobody can review.
        temperature: 0,
      },
    });
  } catch (problem) {
    return {
      ok: false,
      status: 502,
      reason: problem instanceof Error ? problem.message : 'The model could not be reached.',
    };
  }

  // Every decision about what came back is in `reply.ts`, where it can be
  // asserted without an API key. MAX_TOKENS is the one that would otherwise
  // slip through: a truncated answer is valid JSON right up to where it stops,
  // so it parses cleanly and would be shown as complete.
  return interpret<T>(response);
}
