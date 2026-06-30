/**
 * Cash Shop — premium cosmetic catalog.
 *
 * Parallels MapleStory's NX Cash / Cash Shop layer, reskinned as "Maple Crystals".
 * Pure data + pure functions. No runtime deps.
 *
 * Phase-2 note: Maple Crystals will bridge to the on-chain $MAPLE token
 * (ERC-20) for verifiable purchases and tradeable cosmetics. For now this
 * is an off-chain placeholder — the server will track balances and purchases
 * in-memory / database, and the on-chain bridge is deferred.
 */

import type { CharacterAppearance } from "./appearance.js";
import { HAIR_STYLES, HAIR_COLORS, FACE_STYLES, STARTER_OUTFITS } from "./appearance.js";

// ---------------------------------------------------------------------------
// Premium currency label
// ---------------------------------------------------------------------------

/** Display name for the premium currency. */
export const PREMIUM_CURRENCY = "Maple Crystals" as const;

/** Shorthand ticker / code used in data and UI. */
export const PREMIUM_TICKER = "MC" as const;

// ---------------------------------------------------------------------------
// Cash item definition
// ---------------------------------------------------------------------------

export type CashCategory =
  | "hair"
  | "face"
  | "outfit"
  | "weapon-skin"
  | "pet"
  | "effect"
  | "consumable";

export interface CashItemDef {
  readonly id: string;
  readonly name: string;
  readonly category: CashCategory;
  /** Price in premium currency units (Maple Crystals). */
  readonly price: number;
  /** If set, the item expires after this many days. */
  readonly durationDays?: number;
  /** Optional appearance fields that override the character's base look. */
  readonly appearanceOverride?: Partial<CharacterAppearance>;
}

// ---------------------------------------------------------------------------
// Catalog — placeholder cosmetics across every category
// ---------------------------------------------------------------------------

export const CASH_ITEMS: Record<string, CashItemDef> = {
  // ── Hair ──────────────────────────────────────────────────────────────
  cash_hair_rainbow: {
    id: "cash_hair_rainbow",
    name: "Rainbow Spikes",
    category: "hair",
    price: 500,
    appearanceOverride: { hairId: "hair_spiky", hairColorId: "color_pink" },
  },
  cash_hair_bob_blonde: {
    id: "cash_hair_bob_blonde",
    name: "Platinum Bob",
    category: "hair",
    price: 400,
    appearanceOverride: { hairId: "hair_bob", hairColorId: "color_blonde" },
  },
  cash_hair_long_white: {
    id: "cash_hair_long_white",
    name: "Moonlit Locks",
    category: "hair",
    price: 450,
    durationDays: 30,
    appearanceOverride: { hairId: "hair_long", hairColorId: "color_white" },
  },

  // ── Face ──────────────────────────────────────────────────────────────
  cash_face_determined: {
    id: "cash_face_determined",
    name: "Battle-Hardened Eyes",
    category: "face",
    price: 300,
    appearanceOverride: { faceId: "face_determined" },
  },
  cash_face_wonder: {
    id: "cash_face_wonder",
    name: "Starlit Gaze",
    category: "face",
    price: 350,
    durationDays: 14,
    appearanceOverride: { faceId: "face_wonder" },
  },

  // ── Outfit ────────────────────────────────────────────────────────────
  cash_outfit_phoenix_robe: {
    id: "cash_outfit_phoenix_robe",
    name: "Phoenix Robe",
    category: "outfit",
    price: 2000,
    appearanceOverride: { outfitId: "outfit_robe" },
  },
  cash_outfit_island_dress: {
    id: "cash_outfit_island_dress",
    name: "Blossom Island Dress",
    category: "outfit",
    price: 1800,
    appearanceOverride: { outfitId: "outfit_dress" },
  },

  // ── Weapon Skin ───────────────────────────────────────────────────────
  cash_wpn_flame_blade: {
    id: "cash_wpn_flame_blade",
    name: "Blazing Blade Skin",
    category: "weapon-skin",
    price: 1200,
  },
  cash_wpn_ice_staff: {
    id: "cash_wpn_ice_staff",
    name: "Frost Staff Skin",
    category: "weapon-skin",
    price: 1200,
    durationDays: 90,
  },

  // ── Pet ───────────────────────────────────────────────────────────────
  cash_pet_mini_dragon: {
    id: "cash_pet_mini_dragon",
    name: "Mini Dragon",
    category: "pet",
    price: 3000,
  },

  // ── Effect ────────────────────────────────────────────────────────────
  cash_effect_sparkle: {
    id: "cash_effect_sparkle",
    name: "Sparkle Trail",
    category: "effect",
    price: 800,
    durationDays: 30,
  },

  // ── Consumable ────────────────────────────────────────────────────────
  cash_cons_xp_booster: {
    id: "cash_cons_xp_booster",
    name: "2× EXP Booster (1 hr)",
    category: "consumable",
    price: 250,
    durationDays: 1, // expires 1 day after use / purchase
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a single cash item by id. Returns `undefined` when not found. */
export function getCashItem(id: string): CashItemDef | undefined {
  return CASH_ITEMS[id];
}

/** Return all cash items belonging to `category`. */
export function cashItemsByCategory(category: CashCategory): CashItemDef[] {
  return Object.values(CASH_ITEMS).filter((item) => item.category === category);
}

/**
 * Map a cash category to the CharacterAppearance fields it overrides.
 * Categories without cosmetic appearance (weapon-skin, pet, effect, consumable) return empty.
 */
export function appearanceFieldsForCategory(category: CashCategory): (keyof CharacterAppearance)[] {
  switch (category) {
    case "hair":
      return ["hairId", "hairColorId"];
    case "face":
      return ["faceId"];
    case "outfit":
      return ["outfitId"];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Appearance-array references (exported for the test suite's integrity checks)
// ---------------------------------------------------------------------------

/** All valid appearance IDs from the base appearance arrays. */
export const VALID_APPEARANCE_IDS: ReadonlySet<string> = new Set([
  ...HAIR_STYLES.map((h) => h.id),
  ...HAIR_COLORS.map((c) => c.id),
  ...FACE_STYLES.map((f) => f.id),
  ...STARTER_OUTFITS.map((o) => o.id),
]);
