/**
 * Consumables & Scrolls — non-equip items and the equipment enhancement (scrolling) system.
 *
 *  • ConsumableDef: potions, stat buffs, town-return scrolls.
 *  • ScrollDef + applyScroll: the equipment-scrolling system where each success permanently
 *    raises an ItemInstance's stats. On failure the scroll is consumed with no effect.
 *
 * Pure data + pure functions — same as everything in @maple/shared.
 */

import { EquipSlot } from "./items.js";
import type { ItemInstance, ScrollStatKind, EnhancementLine } from "./items.js";
import { rerollBonusStats, getItemDef } from "./items.js";
import type { SecondaryStats } from "./stats.js";

// ─── Consumables ────────────────────────────────────────────────────────────

export interface HealEffect {
  readonly kind: "heal";
  /** Flat HP restored. */
  readonly hp?: number;
  /** Flat MP restored. */
  readonly mp?: number;
  /** If true, hp/mp values are percentages of the character's max (0–100). */
  readonly percent?: boolean;
}

export interface ConsumableBuffEffect {
  readonly kind: "buff";
  /** Which secondary stats to boost (only set fields are applied). */
  readonly secondary: Partial<SecondaryStats>;
  /** How long the buff lasts in milliseconds. */
  readonly durationMs: number;
}

export interface RecallEffect {
  readonly kind: "recall";
  /** Destination map id (e.g. "heartland_harbor"). */
  readonly toMapId: string;
  /** Destination spawn point within that map. */
  readonly toSpawnId: string;
}

export interface PetFoodEffect {
  readonly kind: "pet_food";
  /** How much fullness this food restores. */
  readonly fullnessRestore: number;
}

export type ConsumableEffect = HealEffect | ConsumableBuffEffect | RecallEffect | PetFoodEffect;

export interface ConsumableDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly effect: ConsumableEffect;
  /** Cooldown in ms before this consumable can be used again (0 = no cooldown). */
  readonly cooldownMs: number;
  /** Mesos buy price (for NPC shops). 0 or omitted = not sold by NPCs. */
  readonly mesos?: number;
}

// ─── Consumable catalog ─────────────────────────────────────────────────────

export const CONSUMABLES: Record<string, ConsumableDef> = {
  // ── HP potions ──────────────────────────────────────────────────
  "pot.small_hp": {
    id: "pot.small_hp",
    name: "Minor Healing Tonic",
    description: "Restores 50 HP.",
    effect: { kind: "heal", hp: 50 },
    cooldownMs: 0,
    mesos: 20,
  },
  "pot.large_hp": {
    id: "pot.large_hp",
    name: "Greater Healing Tonic",
    description: "Restores 150 HP.",
    effect: { kind: "heal", hp: 150 },
    cooldownMs: 0,
    mesos: 60,
  },
  // ── MP potions ──────────────────────────────────────────────────
  "pot.small_mp": {
    id: "pot.small_mp",
    name: "Minor Mana Tonic",
    description: "Restores 30 MP.",
    effect: { kind: "heal", mp: 30 },
    cooldownMs: 0,
    mesos: 25,
  },
  "pot.large_mp": {
    id: "pot.large_mp",
    name: "Greater Mana Tonic",
    description: "Restores 100 MP.",
    effect: { kind: "heal", mp: 100 },
    cooldownMs: 0,
    mesos: 75,
  },
  // ── Combined potions ────────────────────────────────────────────
  "pot.combined_small": {
    id: "pot.combined_small",
    name: "Elixir of Vitality",
    description: "Restores 50 HP and 30 MP.",
    effect: { kind: "heal", hp: 50, mp: 30 },
    cooldownMs: 0,
    mesos: 40,
  },
  "pot.combined_large": {
    id: "pot.combined_large",
    name: "Elixir of Fortitude",
    description: "Restores 150 HP and 100 MP.",
    effect: { kind: "heal", hp: 150, mp: 100 },
    cooldownMs: 0,
    mesos: 100,
  },
  // ── Percent potions ─────────────────────────────────────────────
  "pot.hp_percent": {
    id: "pot.hp_percent",
    name: "Full Restoration Draught",
    description: "Restores 30% of max HP.",
    effect: { kind: "heal", hp: 30, percent: true },
    cooldownMs: 5000,
    mesos: 200,
  },
  // ── Stat buffs ──────────────────────────────────────────────────
  "buff.power_elixir": {
    id: "buff.power_elixir",
    name: "Elixir of Strength",
    description: "Boosts ATK and accuracy for 60 seconds.",
    effect: {
      kind: "buff",
      secondary: { atk: 15, accuracy: 10 },
      durationMs: 60_000,
    },
    cooldownMs: 0,
  },
  "buff.swiftfoot_tonic": {
    id: "buff.swiftfoot_tonic",
    name: "Tonic of Swiftness",
    description: "Boosts movement speed and jump for 30 seconds.",
    effect: {
      kind: "buff",
      secondary: { speed: 20, jump: 15 },
      durationMs: 30_000,
    },
    cooldownMs: 0,
  },
  "buff.arcane_draught": {
    id: "buff.arcane_draught",
    name: "Draught of Arcane Power",
    description: "Boosts magical attack and crit rate for 45 seconds.",
    effect: {
      kind: "buff",
      secondary: { mAtk: 12, critRate: 0.05 },
      durationMs: 45_000,
    },
    cooldownMs: 0,
  },
  // ── Town-return scroll ──────────────────────────────────────────
  "scroll.return": {
    id: "scroll.return",
    name: "Return Scroll",
    description: "Teleports you back to Tidewatch Harbor.",
    effect: {
      kind: "recall",
      toMapId: "heartland_harbor",
      toSpawnId: "dock",
    },
    cooldownMs: 10_000,
  },
  // ── Legacy entries (server/client compat) ────────────────────────
  "con.hp_potion_s": {
    id: "con.hp_potion_s",
    name: "Small HP Potion",
    description: "Restores 50 HP.",
    effect: { kind: "heal", hp: 50 },
    cooldownMs: 0,
    mesos: 20,
  },
  "con.hp_potion_m": {
    id: "con.hp_potion_m",
    name: "Medium HP Potion",
    description: "Restores 150 HP.",
    effect: { kind: "heal", hp: 150 },
    cooldownMs: 0,
    mesos: 60,
  },
  "con.mp_potion_s": {
    id: "con.mp_potion_s",
    name: "Small MP Potion",
    description: "Restores 30 MP.",
    effect: { kind: "heal", mp: 30 },
    cooldownMs: 0,
    mesos: 25,
  },
  "con.mp_potion_m": {
    id: "con.mp_potion_m",
    name: "Medium MP Potion",
    description: "Restores 100 MP.",
    effect: { kind: "heal", mp: 100 },
    cooldownMs: 0,
    mesos: 75,
  },
  "con.return_scroll": {
    id: "con.return_scroll",
    name: "Return to Town Scroll",
    description: "Teleports you to the nearest town.",
    effect: {
      kind: "recall",
      toMapId: "heartland_harbor",
      toSpawnId: "dock",
    },
    cooldownMs: 10_000,
    mesos: 300,
  },
  // ── Flame (bonus stat reroll) ─────────────────────────────────
  "flame.bonus_scroll": {
    id: "flame.bonus_scroll",
    name: "Flame of Rebirth",
    description: "Re-rolls bonus stat lines on equipment.",
    effect: { kind: "recall", toMapId: "", toSpawnId: "" }, // consumed by server handler, not a real effect
    cooldownMs: 0,
    mesos: 0,
  },
  // ── Pet food ────────────────────────────────────────────────────
  "petfood.basic": {
    id: "petfood.basic",
    name: "Basic Pet Snack",
    description: "Restores 20 pet fullness.",
    effect: { kind: "pet_food", fullnessRestore: 20 },
    cooldownMs: 0,
    mesos: 50,
  },
  "petfood.deluxe": {
    id: "petfood.deluxe",
    name: "Deluxe Pet Treat",
    description: "Restores 30 pet fullness.",
    effect: { kind: "pet_food", fullnessRestore: 30 },
    cooldownMs: 0,
    mesos: 150,
  },
  "petfood.premium": {
    id: "petfood.premium",
    name: "Premium Pet Cuisine",
    description: "Restores 50 pet fullness.",
    effect: { kind: "pet_food", fullnessRestore: 50 },
    cooldownMs: 0,
    mesos: 500,
  },
};

/** Check if a consumable defId is pet food. */
export function isPetFoodConsumable(defId: string): boolean {
  return defId.startsWith("petfood.");
}

/** Get the fullness restore amount for a pet food consumable defId. */
export function getPetFoodRestore(defId: string): number {
  const def = CONSUMABLES[defId];
  if (def && def.effect.kind === "pet_food") return def.effect.fullnessRestore;
  return 0;
}

/**
 * Apply a heal consumable's effect to current HP/MP, clamped to max.
 * Pure function — no mutations. Returns the new { hp, mp }.
 */
export function applyHealEffect(
  effect: HealEffect,
  currentHp: number,
  currentMp: number,
  maxHp: number,
  maxMp: number,
): { hp: number; mp: number } {
  let hp = currentHp;
  let mp = currentMp;

  if (effect.hp !== undefined) {
    if (effect.percent) {
      hp = Math.min(maxHp, hp + Math.floor((maxHp * effect.hp) / 100));
    } else {
      hp = Math.min(maxHp, hp + effect.hp);
    }
  }
  if (effect.mp !== undefined) {
    if (effect.percent) {
      mp = Math.min(maxMp, mp + Math.floor((maxMp * effect.mp) / 100));
    } else {
      mp = Math.min(maxMp, mp + effect.mp);
    }
  }

  return { hp, mp };
}

/** Look up a consumable def by id. */
export function getConsumableDef(defId: string): ConsumableDef | undefined {
  return CONSUMABLES[defId];
}

/** Check if an item ID is a consumable (vs equipment). */
export function isConsumable(defId: string): boolean {
  return defId in CONSUMABLES;
}

// ─── Flame Reroll ─────────────────────────────────────────────────────────

/**
 * Re-roll an item's bonus (flame) stats.
 * Pure function — returns a new ItemInstance with fresh bonusStats.
 * The caller (server) must validate mesos / consume the flame material.
 */
export function applyFlame(instance: ItemInstance, rng: () => number = Math.random): ItemInstance {
  const def = getItemDef(instance.defId);
  const itemLevel = def?.levelReq ?? 1;
  return rerollBonusStats(instance, itemLevel, rng);
}

// ─── Scrolls (equipment enhancement) ────────────────────────────────────────

export interface ScrollDef {
  readonly id: string;
  readonly name: string;
  /** Which equipment slot this scroll targets. */
  readonly targetSlot: EquipSlot;
  /** Probability of success in [0, 1]. 1 = guaranteed. */
  readonly successRate: number;
  /** Flat stat delta applied on success (always positive; the scroll itself determines the sign). */
  readonly statDelta: number;
  /** Which stat the delta applies to. */
  readonly statKind: ScrollStatKind;
}

// ─── Scroll catalog ─────────────────────────────────────────────────────────

export const SCROLLS: Record<string, ScrollDef> = {
  // ── Weapon ATK scrolls ──────────────────────────────────────────
  "scrl.weap_atk_10": {
    id: "scrl.weap_atk_10",
    name: "Weapon Attack Scroll (10%)",
    targetSlot: EquipSlot.WEAPON,
    successRate: 0.1,
    statDelta: 3,
    statKind: "ATK",
  },
  "scrl.weap_atk_60": {
    id: "scrl.weap_atk_60",
    name: "Weapon Attack Scroll (60%)",
    targetSlot: EquipSlot.WEAPON,
    successRate: 0.6,
    statDelta: 3,
    statKind: "ATK",
  },
  // ── Armor defence scrolls ───────────────────────────────────────
  "scrl.armor_wdef_10": {
    id: "scrl.armor_wdef_10",
    name: "Armor Defence Scroll (10%)",
    targetSlot: EquipSlot.TOP,
    successRate: 0.1,
    statDelta: 5,
    statKind: "WDEF",
  },
  "scrl.armor_wdef_60": {
    id: "scrl.armor_wdef_60",
    name: "Armor Defence Scroll (60%)",
    targetSlot: EquipSlot.TOP,
    successRate: 0.6,
    statDelta: 5,
    statKind: "WDEF",
  },
  // ── Primary stat scrolls ────────────────────────────────────────
  "scrl.str_60": {
    id: "scrl.str_60",
    name: "STR Scroll (60%)",
    targetSlot: EquipSlot.WEAPON,
    successRate: 0.6,
    statDelta: 2,
    statKind: "STR",
  },
  "scrl.dex_60": {
    id: "scrl.dex_60",
    name: "DEX Scroll (60%)",
    targetSlot: EquipSlot.GLOVES,
    successRate: 0.6,
    statDelta: 2,
    statKind: "DEX",
  },
  // ── HP/MP scrolls ───────────────────────────────────────────────
  "scrl.hp_40": {
    id: "scrl.hp_40",
    name: "HP Scroll (40%)",
    targetSlot: EquipSlot.HAT,
    successRate: 0.4,
    statDelta: 30,
    statKind: "HP",
  },
  "scrl.mp_40": {
    id: "scrl.mp_40",
    name: "MP Scroll (40%)",
    targetSlot: EquipSlot.HAT,
    successRate: 0.4,
    statDelta: 25,
    statKind: "MP",
  },
  // ── Speed scroll ────────────────────────────────────────────────
  "scrl.speed_70": {
    id: "scrl.speed_70",
    name: "Speed Scroll (70%)",
    targetSlot: EquipSlot.SHOES,
    successRate: 0.7,
    statDelta: 3,
    statKind: "SPEED",
  },
};

// ─── applyScroll — pure, deterministic ──────────────────────────────────────

/**
 * Attempt to apply a scroll to an equipment item instance.
 *
 * @param instance - The item to enhance (not mutated).
 * @param scroll   - The scroll definition to apply.
 * @param rng      - RNG returning [0, 1). Defaults to Math.random.
 * @returns A **new** ItemInstance with an added EnhancementLine on success,
 *          or the original instance on failure.
 */
export function applyScroll(
  instance: ItemInstance,
  scroll: ScrollDef,
  rng: () => number = Math.random,
): ItemInstance {
  const roll = rng();
  if (roll >= scroll.successRate) {
    // Failure — scroll is consumed, item is unchanged.
    return instance;
  }

  const line: EnhancementLine = {
    statKind: scroll.statKind,
    delta: scroll.statDelta,
  };

  return {
    ...instance,
    enhancements: [...(instance.enhancements ?? []), line],
  };
}
