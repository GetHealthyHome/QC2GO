/**
 * Which files in the photo bucket are safe to delete.
 *
 * `pushPhoto` puts the bytes in the bucket first and the row second, so that a
 * row never points at a file that is not there. The cost is the other
 * direction: a row upload that fails after the file has landed leaves the file
 * with nothing referencing it — invisible to the app and costing storage
 * forever. Nothing cleans that up today.
 *
 * ## This is the only code in QC2GO that deletes evidence
 *
 * Everything else about a photo is additive or reversible. This is not. A bug
 * here does not produce a wrong number on a screen; it destroys the photographic
 * record of a job that somebody may need in a warranty dispute two years from
 * now, and there is no undo and no second copy on the server.
 *
 * So the decision is a pure function, and every guard below exists because of a
 * specific way this could go wrong:
 *
 *   - A transient database error must never read as "no photos exist", which
 *     would make every file in the bucket an orphan. An unknown answer is not
 *     an empty one, and the two are different types here.
 *   - A file being uploaded right now has no row yet by definition, so anything
 *     recent is left alone regardless.
 *   - If most of the bucket looks orphaned, something is wrong with the question
 *     rather than with the bucket, and the sweep refuses rather than proceeds.
 *   - A single run can only delete so much, so even a mistake that gets past
 *     everything above is bounded and visible before it is total.
 *
 * The device keeps its own copy of the blob until the row lands, and `pushPhoto`
 * re-uploads on every retry — so a file collected in error while its outbox
 * entry is still pending comes back by itself. That is the safety net, not an
 * excuse to be careless.
 */

export interface StorageObject {
  /** Full path within the bucket, e.g. `<org>/<inspection>/<photo>.jpg`. */
  path: string;
  /** When the object landed in the bucket. */
  createdAt: string;
}

/**
 * How long a file is left alone regardless of whether a row points at it.
 *
 * An outbox entry retries with backoff and a device can be offline for days, so
 * this has to comfortably outlast any in-flight upload. Seven days costs a
 * trivial amount of storage and removes the entire class of "collected
 * something that was still on its way".
 */
export const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Nothing gets deleted in bulk on the strength of one query. */
export const MAX_PER_RUN = 500;

/**
 * If more than this fraction of what we looked at appears orphaned, the
 * question is wrong rather than the bucket. A real orphan rate is a rounding
 * error; a half-empty result set is a bug.
 */
export const REFUSE_ABOVE_FRACTION = 0.5;

/**
 * Below this many aged objects, the fraction means nothing and the check is
 * skipped — one orphan in a bucket of two is 50% and entirely ordinary on a
 * young deployment. Without this, a small company could never be swept at all,
 * which is the failure mode where a safety valve quietly becomes a wall.
 * The per-run cap still bounds what a small bucket can lose.
 */
export const MIN_SAMPLE_FOR_BREAKER = 20;

/**
 * What the database said about which paths are referenced.
 *
 * A discriminated union rather than a bare `Set`, because the dangerous mistake
 * is treating "the query failed" as "nothing is referenced" — and a type that
 * cannot express the difference is a type that will eventually make it.
 */
export type KnownPaths =
  | { ok: true; paths: Set<string> }
  | { ok: false; reason: string };

export interface SweepDecision {
  /** Paths safe to delete now. */
  collect: string[];
  /** Why the rest were left, in a form worth logging. */
  kept: {
    referenced: number;
    tooRecent: number;
    /** Held back only by the per-run cap — there are more next time. */
    overCap: number;
  };
  /** Set when the sweep declined to delete anything at all, and why. */
  refused?: string;
}

/**
 * Supabase creates these to keep an empty prefix visible. They belong to no
 * photo and deleting one would make a folder vanish from the dashboard.
 */
function isPlaceholder(path: string): boolean {
  return path.endsWith('.emptyFolderPlaceholder');
}

export function decideSweep(input: {
  objects: StorageObject[];
  known: KnownPaths;
  now: Date;
  graceMs?: number;
  maxPerRun?: number;
}): SweepDecision {
  const { objects, known, now } = input;
  const graceMs = input.graceMs ?? GRACE_MS;
  const maxPerRun = input.maxPerRun ?? MAX_PER_RUN;
  const empty: SweepDecision['kept'] = { referenced: 0, tooRecent: 0, overCap: 0 };

  if (!known.ok) {
    return { collect: [], kept: empty, refused: `Could not read the photo rows: ${known.reason}` };
  }

  const candidates: string[] = [];
  const kept = { ...empty };

  for (const object of objects) {
    if (isPlaceholder(object.path)) continue;

    // Exact match, never a prefix: `.../p1.jpg` and `.../p1.jpg.bak` are
    // different files, and a prefix test would let one keep the other alive —
    // or worse, delete it.
    if (known.paths.has(object.path)) {
      kept.referenced += 1;
      continue;
    }

    const age = now.getTime() - new Date(object.createdAt).getTime();
    // An unparseable timestamp is treated as brand new. Guessing old on a date
    // we cannot read would delete a file to resolve our own uncertainty.
    if (!Number.isFinite(age) || age < graceMs) {
      kept.tooRecent += 1;
      continue;
    }

    candidates.push(object.path);
  }

  const considered = candidates.length + kept.referenced;
  if (
    considered >= MIN_SAMPLE_FOR_BREAKER &&
    candidates.length / considered > REFUSE_ABOVE_FRACTION
  ) {
    return {
      collect: [],
      kept,
      refused:
        `${candidates.length} of ${considered} aged objects had no row. ` +
        'That is too many to be genuine orphans — refusing to delete anything.',
    };
  }

  kept.overCap = Math.max(0, candidates.length - maxPerRun);
  return { collect: candidates.slice(0, maxPerRun), kept };
}
