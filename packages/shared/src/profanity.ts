/**
 * Basic profanity filter — a simple word blocklist for alpha.
 * Replace matched words with asterisks. Intentionally lightweight; upgrade to
 * a library (e.g. bad-words) when the game goes public.
 */

const BLOCKED = [
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
];

/** Single word-boundary regex built from the blocklist (case-insensitive). */
const PROFANITY_RE = new RegExp(`\\b(${BLOCKED.join("|")})\\b`, "gi");

/** Check whether text contains any blocked words (word-boundary aware). */
export function containsProfanity(text: string): boolean {
  PROFANITY_RE.lastIndex = 0;
  return PROFANITY_RE.test(text);
}

/** Replace blocked words with `****` (same length as the matched word). */
export function filterProfanity(text: string): string {
  return text.replace(PROFANITY_RE, (m) => "*".repeat(m.length));
}
