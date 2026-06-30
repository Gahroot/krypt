/**
 * Character helpers shared by the room handlers and the REST character endpoints.
 *
 * Keeping name validation, the slot cap, appearance sanitisation, and the
 * client-facing summary shape here means the Colyseus `MapRoom` and the
 * `/characters` HTTP routes enforce exactly the same authoritative rules — the
 * client can never widen them.
 */
import {
  SKIN_TONES,
  HAIR_STYLES,
  HAIR_COLORS,
  FACE_STYLES,
  STARTER_OUTFITS,
  getClass,
  getMap,
  randomizeAppearance,
  filterProfanity,
  ClassArchetype,
  type CharacterAppearance,
  type Gender,
} from "@maple/shared";
import type { CharacterRecord } from "./persistence/store";

/** Maximum number of characters a single account may own (a sane slot cap). */
export const MAX_CHARACTERS_PER_ACCOUNT = 6;

/** Min/max length for a character name. */
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 16;

/** Allowed characters for a character name (length checked separately). */
const NAME_RE = /^[a-zA-Z0-9 _-]+$/;

/**
 * Names reserved for the system, staff, or chat targets — players may not take
 * them regardless of casing or internal spacing/punctuation.
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "gm",
  "gamemaster",
  "moderator",
  "mod",
  "system",
  "server",
  "console",
  "npc",
  "null",
  "undefined",
  "none",
  "root",
  "support",
  "staff",
  "maple",
  "cryptomaple",
  "everyone",
  "all",
]);

/** Stable, user-visible message + code for a globally-taken name. */
export const NAME_TAKEN_CODE = "name_taken";
export const NAME_TAKEN_MESSAGE = "That name is already taken.";

/**
 * Validate a character name's *format*: length (2–16), allowed characters,
 * profanity (via the shared {@link filterProfanity}), and reserved words.
 * Returns a user-visible error message, or `null` when acceptable. Global
 * uniqueness is enforced separately by the caller against the store.
 */
export function validateCharacterNameFormat(name: string): string | null {
  const trimmed = (name ?? "").trim();
  if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
    return `Name must be ${NAME_MIN_LENGTH}–${NAME_MAX_LENGTH} characters.`;
  }
  if (!NAME_RE.test(trimmed)) {
    return "Name may only contain letters, numbers, spaces, hyphens, and underscores.";
  }
  // Profanity: run the shared filter; if it masks anything the name is blocked.
  if (filterProfanity(trimmed) !== trimmed) {
    return "Name contains a blocked word.";
  }
  // Reserved words, comparing case-insensitively and ignoring spacing/punctuation.
  const key = trimmed.toLowerCase().replace(/[\s_-]+/g, "");
  if (RESERVED_NAMES.has(key)) {
    return "That name is reserved.";
  }
  return null;
}

/** Pull a valid field id from an option set, or return the supplied fallback. */
function validId(value: unknown, options: readonly { id: string }[], fallback: string): string {
  return typeof value === "string" && options.some((o) => o.id === value) ? value : fallback;
}

/**
 * Coerce arbitrary client input into a valid {@link CharacterAppearance}.
 *
 * Every field is checked against the shared option sets; unknown values fall
 * back to a randomised-but-valid look, and the outfit is forced to one the
 * chosen gender can wear. The result is always safe to persist.
 */
export function sanitizeAppearance(input: unknown): CharacterAppearance {
  const base = randomizeAppearance();
  const raw = (input ?? {}) as Partial<Record<keyof CharacterAppearance, unknown>>;

  const gender: Gender = raw.gender === "F" ? "F" : raw.gender === "M" ? "M" : base.gender;

  const validOutfits = STARTER_OUTFITS.filter((o) => o.gender === gender || o.gender === "U");
  const outfitFallback = validOutfits.some((o) => o.id === base.outfitId)
    ? base.outfitId
    : (validOutfits[0]?.id ?? base.outfitId);

  return {
    gender,
    skinId: validId(raw.skinId, SKIN_TONES, base.skinId),
    hairId: validId(raw.hairId, HAIR_STYLES, base.hairId),
    hairColorId: validId(raw.hairColorId, HAIR_COLORS, base.hairColorId),
    faceId: validId(raw.faceId, FACE_STYLES, base.faceId),
    outfitId: validId(raw.outfitId, validOutfits, outfitFallback),
  };
}

/** A compact, client-facing view of a character for the select screen. */
export interface CharacterSummary {
  charId: string;
  name: string;
  /** Class archetype id, e.g. "BEGINNER". */
  archetype: string;
  /** Human-readable class name, e.g. "Beginner". */
  className: string;
  level: number;
  mapId: string;
  /** Human-readable map name, falling back to the id when unknown. */
  mapName: string;
}

/** Project a durable {@link CharacterRecord} down to the {@link CharacterSummary} the client needs. */
export function characterSummary(rec: CharacterRecord): CharacterSummary {
  const archetype = rec.archetype as ClassArchetype;
  const className = Object.values(ClassArchetype).includes(archetype)
    ? getClass(archetype).name
    : rec.archetype;
  return {
    charId: rec.charId,
    name: rec.name,
    archetype: rec.archetype,
    className,
    level: rec.level,
    mapId: rec.mapId,
    mapName: getMap(rec.mapId)?.name ?? rec.mapId,
  };
}
