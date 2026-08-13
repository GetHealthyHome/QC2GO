/**
 * The numbers in a piece of text that a model is not allowed to invent.
 *
 * Both AI features need this, for opposite-looking reasons that turn out to be
 * the same reason.
 *
 * `ai-scribe` uses it to check that a tidied note kept every measurement the
 * inspector wrote and gained none. `ai-checkpoints` uses it to check that a
 * proposed checkpoint did not arrive carrying a threshold nobody asked for —
 * "verify static pressure is below 0.5 in. w.c." is a company standard, and a
 * model that has never seen the company is not the thing that should be
 * setting it.
 *
 * In both cases the question is the same: which numbers are in this text, and
 * were they in the thing it came from. Sharing one implementation means the
 * answer cannot drift between the two features, and that a unit added here is
 * understood by both.
 */

/**
 * Units are compared, not just the numbers in front of them: 12 in and 12 ft
 * are different findings and the digits alone would not tell them apart.
 */
const UNITS: Record<string, string> = {
  in: 'in', inch: 'in', inches: 'in',
  ft: 'ft', foot: 'ft', feet: 'ft',
  yd: 'yd', yds: 'yd', yard: 'yd', yards: 'yd',
  mm: 'mm', cm: 'cm', m: 'm', km: 'km', mi: 'mi', mile: 'mi', miles: 'mi',
  g: 'g', kg: 'kg', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', oz: 'oz',
  ton: 'ton', tons: 'ton',
  psi: 'psi', psf: 'psf', cfm: 'cfm', gpm: 'gpm',
  gal: 'gal', gallon: 'gal', gallons: 'gal', l: 'l', ml: 'ml',
  v: 'v', volt: 'v', volts: 'v', a: 'a', amp: 'a', amps: 'a',
  w: 'w', watt: 'w', watts: 'w', kw: 'kw', kwh: 'kwh',
  hz: 'hz', db: 'db', mph: 'mph', pa: 'pa', kpa: 'kpa',
  '%': '%', percent: '%', pct: '%',
  f: 'f', c: 'c', deg: 'deg', degree: 'deg', degrees: 'deg',
  sf: 'sf', sqft: 'sf', hr: 'hr', hrs: 'hr', hour: 'hr', hours: 'hr',
  min: 'min', mins: 'min', minute: 'min', minutes: 'min',
};

/** A bare number, a decimal, a fraction, or a clock time. */
const NUMBER = /^(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?|\d{1,2}:\d{2})$/;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/°\s*([fc])\b/g, ' $1')
    // Feet and inches marks are units, and become words so that 12" and
    // 12 inches are the same fact rather than two.
    .replace(/(\d)\s*"/g, '$1 in ')
    .replace(/(\d)\s*'(?![a-z])/g, '$1 ft ')
    // 1,200 and 1200 are the same reading.
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
}

/**
 * The things in a piece of text that a rewrite is not allowed to change, in the
 * order they are said. Repeats are collapsed to their first mention, so saying
 * the same measurement once instead of twice is tidying rather than a loss.
 *
 * Exported because the tests are more legible asserting on this directly than
 * inferring it from which rewrites were refused.
 */
export function facts(text: string): string[] {
  const words = normalize(text).match(/[a-z0-9%][a-z0-9%.:/#-]*/g) ?? [];
  const found: string[] = [];
  const add = (fact: string) => {
    if (!found.includes(fact)) found.push(fact);
  };

  words.forEach((word, index) => {
    if (!/\d/.test(word)) return;

    // A serial like SN#A4472-B is several things joined by punctuation. Split
    // it and keep the parts that carry a digit, so that dropping the # or the
    // hyphen — which is tidying, not a change of fact — still matches.
    const parts = word.split(/[#-]+/).filter(Boolean);

    parts.forEach((part, partIndex) => {
      if (!/\d/.test(part)) return;

      const trimmed = part.replace(/[.:/]+$/, '');
      const match = trimmed.match(/^(\d[\d.:/]*?)([a-z%]*)$/);
      if (!match || !NUMBER.test(match[1])) {
        add(`#${trimmed.replace(/[^a-z0-9]/g, '')}`);
        return;
      }

      const [, digits, suffix] = match;
      let unit = suffix;
      // "12 in" as two words, where "12in" was one. The trailing punctuation
      // goes first, or a unit at the end of a sentence is not a unit.
      if (!unit && partIndex === parts.length - 1) {
        const next = words[index + 1]?.replace(/[.:/#-]+$/, '');
        if (next && !/\d/.test(next)) unit = next;
      }

      const canonical = UNITS[unit] ?? '';
      const value = NUMBER.test(digits) && !digits.includes('/') && !digits.includes(':')
        ? String(Number(digits))
        : digits;
      add(canonical ? `${value} ${canonical}` : value);
    });
  });

  return found;
}
