/**
 * Two questions about whether an inspection was actually walked.
 *
 * This is the part of the TRD's KYPiT engine that is worth building for a
 * company running its own crews. The rest of it — carrier lookup on the
 * submitter's phone, WHOIS and domain reputation, VPN and Tor detection,
 * generative-AI image forensics — defends against unknown external submitters,
 * and QC2GO accounts are created by invitation with no self-signup. Those
 * defences guard a door that does not exist here.
 *
 * What is left is cheap, computable from data already on the device, and
 * genuinely useful: a 60-checkpoint inspection answered in ninety seconds was
 * not walked, and a photograph taken twelve miles from the job is not evidence
 * of the job.
 *
 * ## These are prompts, not verdicts
 *
 * Every threshold below is a reason for a supervisor to open a record and look.
 * None of it is proof, none of it blocks a sign-off, and none of it is written
 * to the inspection — a flag is derived on read, so the thresholds can be
 * improved without rewriting a single signed record. That matters more than it
 * sounds: the alternative is a permanent accusation stamped on a QC document by
 * a heuristic that turned out to be wrong.
 */
import type { Customer, Inspection, PhotoRecord } from './types';
import { distanceMiles, formatDistance } from './geo';

/**
 * Fewer answers than this and the timing says nothing. A three-question
 * re-check is legitimately over in twenty seconds.
 */
const MIN_ANSWERS_TO_JUDGE = 8;

/** Prior inspections needed before an inspector has a baseline of their own. */
const MIN_HISTORY = 3;

/**
 * Below this, sustained, nobody is reading a checkpoint and looking at the
 * thing it names.
 *
 * It exists to catch the case the ratio cannot: an inspector who has *always*
 * pencil-whipped has a fast baseline, and comparing them against themselves
 * would clear them forever.
 */
const FLOOR_SECONDS = 4;

/** Fast enough, relative to their own normal pace, to be worth asking about. */
const SUSPICIOUS_RATIO = 0.4;

/**
 * How far a photo may be from the job before it stops being evidence of it.
 *
 * Generous on purpose. A fix taken indoors, in a basement, or through a roof is
 * routinely a few hundred metres out, and a flag that fires on ordinary GPS
 * error is a flag people learn to ignore.
 */
const GEOFENCE_MILES = 0.25;

export interface Velocity {
  /** Answers carrying a timestamp. */
  answered: number;
  /**
   * The median seconds between one answer and the next, or null when there is
   * not enough to judge.
   *
   * Median gap rather than total elapsed time, for two reasons. An inspection
   * left open on a phone overnight has an enormous duration and says nothing.
   * And a walk interrupted by lunch has one huge gap in the middle, which would
   * drag a mean upward and hide exactly the pattern being looked for — a median
   * does not notice it.
   */
  medianGapSeconds: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function velocityOf(inspection: Inspection): Velocity {
  const stamps = Object.values(inspection.responses ?? {})
    .map((response) => response?.answeredAt)
    .filter((at): at is string => typeof at === 'string')
    .map((at) => new Date(at).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);

  if (stamps.length < MIN_ANSWERS_TO_JUDGE) {
    return { answered: stamps.length, medianGapSeconds: null };
  }

  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i += 1) gaps.push((stamps[i] - stamps[i - 1]) / 1000);
  return { answered: stamps.length, medianGapSeconds: median(gaps) };
}

export interface Baseline {
  medianGapSeconds: number;
  /** How many of this inspector's own inspections it was built from. */
  sample: number;
}

/**
 * How fast this inspector normally works.
 *
 * Their own history rather than a company-wide average: crews differ, scopes
 * differ, and a fast inspector held to a slow colleague's pace generates
 * nothing but noise. `exceptId` keeps the inspection being judged out of the
 * standard it is judged against.
 */
export function baselineFor(
  history: Inspection[],
  inspector: string | undefined,
  exceptId?: string,
): Baseline | null {
  const name = inspector?.trim().toLowerCase();
  if (!name) return null;

  const paces = history
    .filter(
      (inspection) =>
        inspection.id !== exceptId &&
        inspection.status === 'completed' &&
        inspection.info?.inspector?.trim().toLowerCase() === name,
    )
    .map((inspection) => velocityOf(inspection).medianGapSeconds)
    .filter((pace): pace is number => pace !== null);

  if (paces.length < MIN_HISTORY) return null;
  return { medianGapSeconds: median(paces)!, sample: paces.length };
}

export type FlagKind = 'velocity' | 'photo-distance';

export interface IntegrityFlag {
  kind: FlagKind;
  /** Short enough for a badge. */
  label: string;
  /** The number that caused it, in words a supervisor can act on. */
  detail: string;
}

/**
 * Answered faster than is plausible.
 *
 * The threshold is the *larger* of the absolute floor and a fraction of their
 * own pace, which is what makes it work in both directions: somebody whose
 * normal is a minute per checkpoint is flagged at twenty seconds, and somebody
 * who is genuinely quick is not flagged for being quick — but nobody is cleared
 * simply because they have always been this fast.
 */
export function velocityFlag(
  inspection: Inspection,
  baseline: Baseline | null,
): IntegrityFlag | null {
  const velocity = velocityOf(inspection);
  if (velocity.medianGapSeconds === null) return null;

  const threshold = baseline
    ? Math.max(FLOOR_SECONDS, baseline.medianGapSeconds * SUSPICIOUS_RATIO)
    : FLOOR_SECONDS;
  if (velocity.medianGapSeconds >= threshold) return null;

  const pace = velocity.medianGapSeconds.toFixed(1);
  return {
    kind: 'velocity',
    label: 'Answered unusually fast',
    detail: baseline
      ? `About ${pace}s per checkpoint across ${velocity.answered} answers — this inspector normally takes ${baseline.medianGapSeconds.toFixed(0)}s.`
      : `About ${pace}s per checkpoint across ${velocity.answered} answers.`,
  };
}

/**
 * Evidence photographed somewhere other than the job.
 *
 * Silent unless both ends are known. A customer with no captured location, or a
 * photo whose coordinates nothing could supply, is the ordinary case rather
 * than a suspicious one — most photos in this app are taken indoors, where a
 * fix often never arrives.
 */
export function photoDistanceFlag(
  photos: PhotoRecord[],
  customer: Customer | undefined,
  radiusMiles = GEOFENCE_MILES,
): IntegrityFlag | null {
  const site = customer?.location;
  if (!site) return null;

  const distances = photos
    .filter((photo) => photo.gps)
    .map((photo) => distanceMiles(site, photo.gps!))
    .filter((miles) => miles > radiusMiles)
    .sort((a, b) => b - a);

  if (distances.length === 0) return null;
  return {
    kind: 'photo-distance',
    label: `${distances.length} photo${distances.length === 1 ? '' : 's'} away from the job`,
    detail: `Furthest was ${formatDistance(distances[0])} from the recorded site location.`,
  };
}

/** Everything worth a supervisor's attention on one inspection. */
export function integrityFlags(input: {
  inspection: Inspection;
  history?: Inspection[];
  photos?: PhotoRecord[];
  customer?: Customer;
}): IntegrityFlag[] {
  const { inspection, history = [], photos = [], customer } = input;
  const baseline = baselineFor(history, inspection.info?.inspector, inspection.id);
  return [
    velocityFlag(inspection, baseline),
    photoDistanceFlag(photos, customer),
  ].filter((flag): flag is IntegrityFlag => flag !== null);
}
