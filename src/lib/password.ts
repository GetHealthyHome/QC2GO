/**
 * Password rules, mirrored on the client.
 *
 * The authority is the server, in `supabase/functions/set-password/authorize.ts`
 * — that is what actually refuses, and it refuses whether or not this file
 * agrees with it. This exists so somebody typing a six-character password is
 * told immediately rather than after a round trip, and so the reason reads the
 * same in both places.
 *
 * `npm run check:set-password-authorization` runs the same inputs through both
 * and asserts they agree, so the mirror cannot quietly drift out of step.
 */

export const MIN_PASSWORD = 10;

/**
 * bcrypt — which is what Supabase hashes with — ignores everything past 72
 * bytes. A longer password is not stronger, it is silently truncated.
 */
export const MAX_PASSWORD_BYTES = 72;

const OBVIOUS = new Set([
  'password12',
  'password123',
  'password1234',
  '1234567890',
  '12345678901',
  '123456789012',
  'qwertyuiop',
  'qwerty12345',
  'letmein123',
  'welcome123',
  'iloveyou12',
  'admin12345',
  'changeme12',
  'passw0rd12',
]);

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** The reason this password would be refused, or null when it is fine. */
export function passwordProblem(value: unknown, email?: string): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'Choose a password.';
  }
  if (value.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters.`;
  }
  if (byteLength(value) > MAX_PASSWORD_BYTES) {
    return `That is too long — ${MAX_PASSWORD_BYTES} bytes is the most that counts, and anything past it would be ignored rather than stored.`;
  }
  if (value !== value.trim()) {
    return 'Remove the spaces at the start or end — they are too easy to lose when it is typed back in.';
  }
  if (value.trim().length === 0) {
    return 'Choose a password.';
  }
  if (OBVIOUS.has(value.toLowerCase())) {
    return 'That is one of the first passwords anybody would try. Choose another.';
  }
  if (email && value.toLowerCase() === email.toLowerCase()) {
    return 'The password cannot be the email address.';
  }
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= MIN_PASSWORD && value.toLowerCase() === local) {
    return 'The password cannot be the email address.';
  }
  return null;
}

/**
 * Words rather than characters, because of how this password actually travels:
 * somebody reads it aloud across a driveway or a mechanical room to a person
 * typing it into a phone. `Xk7#pQ2v` is stronger per character and useless in
 * that moment — "was that a capital?" — whereas "brass-hatch-274" survives
 * being shouted over a compressor.
 *
 * It is a one-time key regardless: the account is flagged `needs_password`, so
 * the app makes them choose their own before it shows them anything.
 */
const WORDS = [
  'amber', 'anchor', 'attic', 'birch', 'blower', 'brass', 'cedar', 'cellar',
  'copper', 'damper', 'ember', 'flue', 'gable', 'gasket', 'girder', 'gravel',
  'harbor', 'hatch', 'hearth', 'hickory', 'ingot', 'jetty', 'kettle', 'lantern',
  'ledger', 'linden', 'lumber', 'maple', 'marsh', 'meadow', 'mortar', 'orchard',
  'pewter', 'pigment', 'plaster', 'quarry', 'rafter', 'ridge', 'rivet', 'saddle',
  'shingle', 'slate', 'solder', 'spruce', 'stanchion', 'tallow', 'timber', 'trellis',
  'trowel', 'valve', 'vellum', 'walnut', 'willow', 'window', 'winter', 'yarrow',
];

/** Uniform over `max`, without the modulo bias a plain `% max` would introduce. */
function randomBelow(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

/** A password somebody can say out loud and somebody else can type first time. */
export function generatePassword(): string {
  const first = WORDS[randomBelow(WORDS.length)];
  let second = WORDS[randomBelow(WORDS.length)];
  while (second === first) second = WORDS[randomBelow(WORDS.length)];
  // 100–999, so it is always three digits and never opens with a zero somebody
  // has to be told about.
  const number = 100 + randomBelow(900);
  return `${first}-${second}-${number}`;
}
