/**
 * Pets — companion creatures that follow the player and auto-loot ground drops.
 *
 * Inspired by MapleStory's pet system:
 *   1. A pet is summoned (from the pet UI) and follows the player.
 *   2. It has a fullness/hunger meter that decays over time.
 *   3. Feeding the pet with pet food consumables restores fullness.
 *   4. While summoned and not hungry (fullness > 0), the pet auto-loots nearby drops.
 *   5. At zero fullness the pet stops auto-looting and must be re-summoned after feeding.
 *
 * This system is separate from combat familiars (familiars.ts) — pets do NOT attack.
 */

// ─── Feature gate ───────────────────────────────────────────────────────────

/**
 * Master switch for the pet system.
 * When `false`, no pet behavior runs. Set to `true` once the system is ready.
 */
export const PET_ENABLED = true;

// ─── Constants ─────────────────────────────────────────────────────────────

/** Maximum fullness a pet can have (100 = full). */
export const PET_FULLNESS_MAX = 100;

/**
 * Milliseconds of game-time per 1 point of fullness decay.
 * At 60 ticks/sec: 1 point per 60 seconds = fullness drains in ~100 minutes.
 */
export const PET_DECAY_INTERVAL_MS = 60_000;

/** Range (px) at which the pet auto-loots drops for its owner. */
export const PET_AUTO_LOOT_RANGE = 120;

/** Range (px) at which the pet follows the owner before stopping. */
export const PET_FOLLOW_RANGE = 80;

/** Movement speed of the pet (px per tick). */
export const PET_SPEED = 0.6;

// ─── Pet definitions ────────────────────────────────────────────────────────

export interface PetDef {
  /** Unique id (e.g. "pet.snail"). */
  id: string;
  /** Display name. */
  name: string;
  /** Mob family used for the sprite (maps to fam_* art). */
  family: string;
}

/** Registered pet catalog — one entry per available pet type. */
export const PETS: Record<string, PetDef> = {
  "pet.snail": {
    id: "pet.snail",
    name: "Snaily",
    family: "snail",
  },
  "pet.dragon": {
    id: "pet.dragon",
    name: "Mini Dragon",
    family: "beast",
  },
  "pet.shroom": {
    id: "pet.shroom",
    name: "Shroomy",
    family: "shroom",
  },
  "pet.blob": {
    id: "pet.blob",
    name: "Blobby",
    family: "blob",
  },
};

/** Look up a pet def by id. Returns undefined if not found. */
export function getPetDef(petId: string): PetDef | undefined {
  return PETS[petId];
}

/** Check whether an item ID is a pet food consumable. */
export function isPetFood(defId: string): boolean {
  return defId.startsWith("petfood.");
}

// ─── Persistent pet state (per-character) ──────────────────────────────────

export interface PetState {
  /** The active pet def id (empty string = no pet summoned). */
  activePetId: string;
  /** Current fullness (0–PET_FULLNESS_MAX). */
  fullness: number;
  /** Whether the pet was summoned this session. */
  summoned: boolean;
}

/** Default empty pet state. */
export const EMPTY_PET_STATE: PetState = {
  activePetId: "",
  fullness: PET_FULLNESS_MAX,
  summoned: false,
};
