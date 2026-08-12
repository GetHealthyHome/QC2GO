/**
 * When to try a failed delivery again, and when to stop.
 *
 * Pulled out as a pure function because the alternative is discovering the
 * backoff is wrong by watching a customer's server get hammered, or by finding
 * out six hours later that nothing ever retried.
 */

/**
 * Six attempts over roughly two and a half hours, then done.
 *
 * The shape matters more than the numbers: the first retry is quick, because
 * most failures are a deploy or a blip and are over in seconds. The last is
 * long, because anything still failing after an hour is not going to be fixed
 * by asking again in thirty seconds.
 */
export const MAX_ATTEMPTS = 6;

const BACKOFF_SECONDS = [30, 120, 600, 1800, 5400];

export function nextAttemptAfter(attempts: number, now: Date): Date | null {
  // `attempts` counts the one that just failed.
  if (attempts >= MAX_ATTEMPTS) return null;
  const wait = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
  return new Date(now.getTime() + wait * 1000);
}

/**
 * Whether a response counts as delivered.
 *
 * Any 2xx. Deliberately not "200 only": receivers answer 201, 202 and 204 all
 * the time and treating those as failures would re-send an event somebody has
 * already acted on.
 */
export function isDelivered(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Whether it is worth trying again at all.
 *
 * A 4xx means the receiver understood and refused — a wrong URL, a revoked
 * token, a body it will never accept. Retrying that for two hours is noise on
 * somebody else's server. 408 and 429 are the exceptions: both explicitly mean
 * "not now", which is a different answer from "no".
 */
export function isWorthRetrying(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status < 400 || status >= 500;
}
