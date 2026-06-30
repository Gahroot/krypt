/**
 * Basic profanity filter — a simple word blocklist for alpha.
 * Replace matched words with asterisks. Intentionally lightweight; upgrade to
 * a library (e.g. bad-words) when the game goes public.
 */

const BLOCKED = new Set([
  "fuck",
  "shit",
  "ass",
  "bitch",
  "damn",
  "hell",
  "crap",
  "dick",
  "piss",
  "bastard",
  "cunt",
  "cock",
  "penis",
  "vagina",
  "whore",
  "slut",
  "retard",
  "nigger",
  "nigga",
  "faggot",
  "fag",
]);

/** Check whether text contains any blocked words (word-boundary aware). */
export function containsProfanity(text: string): boolean {
  const lower = text.toLowerCase();
  for (const word of BLOCKED) {
    if (lower.includes(word)) return true;
  }
  return false;
}

/** Replace blocked words with `****` (same length as the matched word). */
export function filterProfanity(text: string): string {
  let result = text;
  const lower = result.toLowerCase();
  for (const word of BLOCKED) {
    let idx = lower.indexOf(word);
    while (idx !== -1) {
      const mask = "*".repeat(word.length);
      result = result.slice(0, idx) + mask + result.slice(idx + word.length);
      // Rebuild lower for the next search since we mutated result.
      const nextLower = result.toLowerCase();
      idx = nextLower.indexOf(word, idx + mask.length);
    }
  }
  return result;
}
