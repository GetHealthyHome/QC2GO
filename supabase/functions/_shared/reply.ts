/**
 * Reading what came back from the model, before anything else looks at it.
 *
 * Split out from `gemini.ts` so it can be asserted without an API key, and
 * without bundling the SDK. Everything here is a decision about a response
 * shape; nothing here makes a network call.
 *
 * The guard that earns this file its own tests is truncation. When a model runs
 * into its output limit mid-answer the result is not an error and not
 * gibberish — it is the answer so far, which for a one-field object is very
 * often still valid JSON. It parses, it has the field, and it is half a
 * sentence. Nothing downstream can tell that from a complete answer, so it has
 * to be caught here, by the reason the model gave for stopping rather than by
 * the look of what it sent.
 */

export type ModelResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; reason: string };

/**
 * The parts of a Gemini response this cares about.
 *
 * Declared structurally rather than imported from the SDK so that the tests can
 * hand it a plain object, and so a version bump that renames something unused
 * does not become a type error here.
 */
export interface ModelReply {
  promptFeedback?: { blockReason?: string } | null;
  candidates?: Array<{ finishReason?: string }> | null;
  text?: string | null;
}

export function interpret<T>(reply: ModelReply): ModelResult<T> {
  // Checked before the text is read: on a blocked prompt there is no candidate
  // to read it from, and `.text` would be absent rather than an error.
  if (reply.promptFeedback?.blockReason) {
    return { ok: false, status: 422, reason: 'The model declined to answer that.' };
  }

  const finish = reply.candidates?.[0]?.finishReason;
  if (finish && finish !== 'STOP') {
    return {
      ok: false,
      status: 422,
      reason:
        finish === 'MAX_TOKENS'
          ? 'The answer ran longer than it was allowed to, so it was discarded.'
          : 'The model declined to answer that.',
    };
  }

  const text = reply.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, status: 502, reason: 'Nothing usable came back.' };
  }

  try {
    const value = JSON.parse(text);
    // A bare string or number is valid JSON and not an answer. Every caller
    // here asked for an object, and one that got a number would read a missing
    // field off it and carry on as though the model had simply said nothing.
    if (value === null || typeof value !== 'object') {
      return { ok: false, status: 502, reason: 'Nothing usable came back.' };
    }
    return { ok: true, value: value as T };
  } catch {
    return { ok: false, status: 502, reason: 'Nothing usable came back.' };
  }
}
