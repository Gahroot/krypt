/**
 * Familiars — companion creatures derived from mob definitions.
 *
 * Inspired by MapleStory's familiar system:
 *   1. Killing a mob has a small chance to drop its Familiar Card.
 *   2. Picking up the card registers it in the player's Familiar Collection.
 *   3. The player can summon up to N familiars that auto-attack nearby mobs.
 *
 * Stats are derived from the source MobDef so each familiar feels like a mini version of
 * the mob it came from.
 */

import type { MobDef } from "./mobs.js";

// ─── Constants ─────────────────────────────────────────────────────────────

/** Probability that a non-boss mob kill drops its familiar card. */
export const FAMILIAR_CARD_DROP_CHANCE = 0.02;

/** Maximum number of familiars a player can have summoned at once. */
export const FAMILIAR_MAX_SUMMONED = 3;

/** Fraction of the summoning player's ATK that a familiar deals per hit. */
export const FAMILIAR_DAMAGE_FRACTION = 0.3;

/** Milliseconds between familiar attacks. */
export const FAMILIAR_ATTACK_COOLDOWN_MS = 1500;

/** Horizontal aggro detection radius (px). */
export const FAMILIAR_AGGRO_RANGE = 150;

/** Vertical aggro tolerance (px). */
export const FAMILIAR_AGGRO_VERT = 80;

/** Melee attack range (px). */
export const FAMILIAR_ATTACK_RANGE = 50;

/** Range at which a familiar gives up chasing and returns to follow. */
export const FAMILIAR_DEAGGRO_RANGE = 200;

/** Familiar card item-id prefix. */
export const FAMILIAR_CARD_PREFIX = "familiar.card.";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Derived stats for a familiar, computed from its source MobDef. */
export interface FamiliarStats {
  /** Display name (e.g. "Friendly Snail"). */
  name: string;
  /** Source mob's level. */
  level: number;
  /** Familiar HP (fraction of mob maxHp). */
  hp: number;
  /** Familiar attack damage (fraction of player ATK — set at attack time, stored for UI). */
  attackDamage: number;
  /** Movement speed (px/tick). */
  speed: number;
}

/** Persistent familiar collection state stored per-character. */
export interface FamiliarCollection {
  /** Mob def ids whose familiar cards have been registered. */
  registered: string[];
  /** Currently summoned familiar mob def ids. */
  summoned: string[];
}

/** Default empty familiar collection. */
export const EMPTY_FAMILIAR_COLLECTION: FamiliarCollection = {
  registered: [],
  summoned: [],
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build the familiar card item id for a given mob def id. */
export function familiarCardId(mobId: string): string {
  return `${FAMILIAR_CARD_PREFIX}${mobId}`;
}

/** Extract the mob def id from a familiar card item id. Returns null if not a card. */
export function familiarIdFromCard(cardItemId: string): string | null {
  if (!cardItemId.startsWith(FAMILIAR_CARD_PREFIX)) return null;
  return cardItemId.slice(FAMILIAR_CARD_PREFIX.length);
}

/** Check whether an item id is a familiar card. */
export function isFamiliarCard(itemId: string): boolean {
  return itemId.startsWith(FAMILIAR_CARD_PREFIX);
}

/**
 * Derive familiar stats from a source MobDef.
 * The familiar is a weaker, smaller version of the mob.
 */
export function deriveFamiliarStats(mobDef: MobDef): FamiliarStats {
  return {
    name: mobDef.name,
    level: mobDef.level,
    hp: Math.max(1, Math.floor(mobDef.maxHp * 0.5)),
    attackDamage: 0, // resolved at attack time from player ATK × FAMILIAR_DAMAGE_FRACTION
    speed: mobDef.speed,
  };
}
