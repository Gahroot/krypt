/**
 * Items — equipment slots, item definitions, and rolled item instances.
 *
 * An ItemDef is the static template (a "Bronze Shortsword"). An ItemInstance is a concrete dropped
 * item with its rolled Base rank + Potential tier + bonus stat lines — the thing a player owns,
 * trades, and (if Legendary) mints on-chain in Phase 2.
 */

import {
  BaseRank,
  PotentialTier,
  getPotentialTierInfo,
} from "./rarity.js";
import type { PrimaryStat } from "./stats.js";

export enum EquipSlot {
  WEAPON = "WEAPON",
  HAT = "HAT",
  TOP = "TOP",
  BOTTOM = "BOTTOM",
  SHOES = "SHOES",
  GLOVES = "GLOVES",
  CAPE = "CAPE",
  RING = "RING",
}

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly slot: EquipSlot;
  /** Minimum character level to equip. */
  readonly levelReq: number;
  /** Which stat this item primarily boosts. */
  readonly primaryStat: PrimaryStat;
  /** Flat bonus to the primary stat before rank multiplier. */
  readonly baseStatBonus: number;
  /** Weapon attack (0 for armor). */
  readonly baseAttack: number;
}

/** A single rolled bonus-stat line from the Potential system. */
export interface PotentialLine {
  readonly stat: PrimaryStat | "HP" | "MP" | "ATK";
  /** Percent bonus, e.g. 9 = +9%. */
  readonly percent: number;
}

/** A concrete owned item: a def + its rolled quality. */
export interface ItemInstance {
  /** Unique instance id (assigned by the server on drop). */
  readonly uid: string;
  readonly defId: string;
  readonly baseRank: BaseRank;
  readonly potentialTier: PotentialTier;
  readonly potentialLines: readonly PotentialLine[];
}

// ─── MVP item catalog (placeholder gear for the Meadowfield slice) ───────────

export const ITEMS: Record<string, ItemDef> = {
  "wpn.bronze_shortsword": {
    id: "wpn.bronze_shortsword",
    name: "Bronze Shortsword",
    slot: EquipSlot.WEAPON,
    levelReq: 1,
    primaryStat: "STR",
    baseStatBonus: 2,
    baseAttack: 14,
  },
  "wpn.iron_broadsword": {
    id: "wpn.iron_broadsword",
    name: "Iron Broadsword",
    slot: EquipSlot.WEAPON,
    levelReq: 10,
    primaryStat: "STR",
    baseStatBonus: 5,
    baseAttack: 32,
  },
  "hat.leather_cap": {
    id: "hat.leather_cap",
    name: "Leather Cap",
    slot: EquipSlot.HAT,
    levelReq: 5,
    primaryStat: "STR",
    baseStatBonus: 3,
    baseAttack: 0,
  },
  "top.traveler_jerkin": {
    id: "top.traveler_jerkin",
    name: "Traveler's Jerkin",
    slot: EquipSlot.TOP,
    levelReq: 5,
    primaryStat: "STR",
    baseStatBonus: 4,
    baseAttack: 0,
  },
};

export function getItemDef(defId: string): ItemDef | undefined {
  return ITEMS[defId];
}

/** Number of bonus stat lines an instance should roll for its tier. */
export function lineCountForTier(tier: PotentialTier): number {
  return getPotentialTierInfo(tier).lines;
}

/** Human-readable one-line summary, e.g. "Legendary Iron Broadsword (Star-forged)". */
export function describeInstance(inst: ItemInstance): string {
  const def = getItemDef(inst.defId);
  const name = def ? def.name : inst.defId;
  return `${getPotentialTierInfo(inst.potentialTier).label} ${name} (${inst.baseRank})`;
}
