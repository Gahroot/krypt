/**
 * Equipment Sets — MapleStory-parity set bonus system.
 *
 * Each set groups items by a shared setId on ItemDef. Wearing enough pieces
 * (≥ the first bonus threshold) activates stat bonuses. Bonuses stack: wearing
 * all pieces grants every tier's stats added together.
 */

import type { CharacterStats, SecondaryStats } from "./stats.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SetBonus {
  /** Number of set pieces required to unlock this bonus. */
  readonly piecesRequired: number;
  /** Flat stat bonus applied to the character when this threshold is met. */
  readonly stats: Partial<SecondaryStats & CharacterStats>;
}

export interface ItemSet {
  readonly id: string;
  readonly name: string;
  /** defIds of items that belong to this set. */
  readonly pieceDefIds: readonly string[];
  /** Ordered from lowest to highest threshold. */
  readonly bonuses: readonly SetBonus[];
}

// ── Catalog ──────────────────────────────────────────────────────────────────

export const SETS: readonly ItemSet[] = [
  // ── Starter Warrior Set (lv 1-10) ────────────────────────────────────────
  {
    id: "set.starter_warrior",
    name: "Starter Warrior",
    pieceDefIds: [
      "wpn.bronze_shortsword",
      "hat.tattered_hood",
      "top.patchwork_vest",
      "bottom.burlap_leggings",
    ],
    bonuses: [
      {
        piecesRequired: 2,
        stats: { STR: 3 },
      },
      {
        piecesRequired: 3,
        stats: { STR: 3, wDef: 5, HP: 30 },
      },
      {
        piecesRequired: 4,
        stats: { STR: 5, wDef: 5, atk: 8, HP: 50 },
      },
    ],
  },

  // ── Novice Archer Set (lv 10) ─────────────────────────────────────────────
  {
    id: "set.novice_archer",
    name: "Novice Archer",
    pieceDefIds: [
      "wpn.gale_bow",
      "hat.leather_cap",
      "top.traveler_jerkin",
      "bottom.leather_greaves",
      "shoes.worn_boots",
    ],
    bonuses: [
      {
        piecesRequired: 2,
        stats: { DEX: 3 },
      },
      {
        piecesRequired: 3,
        stats: { DEX: 3, accuracy: 10 },
      },
      {
        piecesRequired: 5,
        stats: { DEX: 5, accuracy: 15, atk: 5 },
      },
    ],
  },

  // ── Shadow Initiate Set (lv 10) ───────────────────────────────────────────
  {
    id: "set.shadow_initiate",
    name: "Shadow Initiate",
    pieceDefIds: [
      "wpn.nightfang_dagger",
      "hat.rogue_cowl",
      "top.rogues_wrap",
      "shoes.windwalker_slippers",
      "gloves.rogues_fingerwraps",
    ],
    bonuses: [
      {
        piecesRequired: 2,
        stats: { LUK: 3 },
      },
      {
        piecesRequired: 3,
        stats: { LUK: 3, speed: 5 },
      },
      {
        piecesRequired: 5,
        stats: { LUK: 5, speed: 5, critRate: 0.05 },
      },
    ],
  },

  // ── PQ Mushroom King Set ─────────────────────────────────────────────────
  {
    id: "set.pq_mushroom_king",
    name: "Mushroom King",
    pieceDefIds: ["hat.pq_mushroom_helm"],
    bonuses: [
      {
        piecesRequired: 1,
        stats: { STR: 3, DEX: 3, HP: 50, wDef: 5 },
      },
    ],
  },

  // ── PQ Dusk Ward Subway Set ─────────────────────────────────────────────
  {
    id: "set.pq_subway_guard",
    name: "Subway Guard",
    pieceDefIds: ["top.pq_subway_vest", "cape.ironbound_cape"],
    bonuses: [
      {
        piecesRequired: 2,
        stats: { STR: 3, DEX: 3, HP: 80, wDef: 5, mDef: 3 },
      },
    ],
  },

  // ── PQ Slime Pit Set ──────────────────────────────────────────────────────
  {
    id: "set.pq_slime_pit",
    name: "Slime Pit",
    pieceDefIds: ["cape.pq_slime_cloak"],
    bonuses: [
      {
        piecesRequired: 1,
        stats: { INT: 3, LUK: 3, MP: 50, mDef: 5 },
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // Mid-game & End-game sets (lv20–60)
  // Bonuses stack additively: wearing all pieces grants every tier's stats.
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Warrior Lv20 — Iron Vanguard ──────────────────────────────────────────
  {
    id: "set.iron_vanguard",
    name: "Iron Vanguard",
    pieceDefIds: [
      "wpn.steel_fang",
      "hat.iron_crest_helm",
      "top.chainmail_tunic",
      "bottom.steel_chausses",
      "shoes.ironclad_sabatons",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { STR: 3 } },
      { piecesRequired: 3, stats: { STR: 3, wDef: 8 } },
      { piecesRequired: 4, stats: { STR: 4, wDef: 8, atk: 6 } },
      { piecesRequired: 5, stats: { STR: 4, wDef: 8, atk: 6, HP: 40 } },
    ],
  },

  // ── Warrior Lv30 — Stormwall ──────────────────────────────────────────────
  {
    id: "set.stormwall",
    name: "Stormwall",
    pieceDefIds: [
      "wpn.earthcrusher",
      "hat.steel_vanguard",
      "top.plate_cuirass",
      "bottom.iron_legguards",
      "gloves.steel_vambraces",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { STR: 4 } },
      { piecesRequired: 3, stats: { STR: 4, wDef: 10, HP: 40 } },
      { piecesRequired: 4, stats: { STR: 5, wDef: 10, atk: 8, HP: 40 } },
      { piecesRequired: 5, stats: { STR: 5, wDef: 10, atk: 8, HP: 40, critRate: 0.02 } },
    ],
  },

  // ── Warrior Lv40 — Dragon's Ward ─────────────────────────────────────────
  {
    id: "set.dragons_ward",
    name: "Dragon's Ward",
    pieceDefIds: [
      "wpn.solstice_blade",
      "hat.dragonbone_crown",
      "top.ironwrought_mantle",
      "bottom.dragonscale_tassets",
      "shoes.dragonscale_treads",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { STR: 5 } },
      { piecesRequired: 3, stats: { STR: 5, wDef: 12, HP: 60 } },
      { piecesRequired: 4, stats: { STR: 6, wDef: 12, atk: 10, HP: 60 } },
      { piecesRequired: 5, stats: { STR: 6, wDef: 12, atk: 10, HP: 60, critRate: 0.03, speed: 3 } },
    ],
  },

  // ── Warrior Lv50 — Obsidian Rampart ──────────────────────────────────────
  {
    id: "set.obsidian_rampart",
    name: "Obsidian Rampart",
    pieceDefIds: [
      "wpn.voidcleaver",
      "hat.obsidian_greathelm",
      "top.dragonscale_aegis",
      "bottom.obsidian_cuisses",
      "gloves.dragonscale_grips",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { STR: 6 } },
      { piecesRequired: 3, stats: { STR: 6, wDef: 15, HP: 80 } },
      { piecesRequired: 4, stats: { STR: 7, wDef: 15, atk: 12, HP: 80 } },
      { piecesRequired: 5, stats: { STR: 7, wDef: 15, atk: 12, HP: 80, critRate: 0.03, speed: 5 } },
    ],
  },

  // ── Warrior Lv60 — Aether Bastion ────────────────────────────────────────
  {
    id: "set.aether_bastion",
    name: "Aether Bastion",
    pieceDefIds: [
      "wpn.aetherfang",
      "hat.aethercrest_helm",
      "top.aetherplate_vestment",
      "bottom.aethermail_legguards",
      "gloves.aetherforged_gauntlets",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { STR: 8 } },
      { piecesRequired: 3, stats: { STR: 8, wDef: 18, HP: 100 } },
      { piecesRequired: 4, stats: { STR: 8, wDef: 18, atk: 15, HP: 100 } },
      {
        piecesRequired: 5,
        stats: { STR: 10, wDef: 18, atk: 15, HP: 100, critRate: 0.05, speed: 5 },
      },
    ],
  },

  // ── Mage Lv20 — Frost Scholar ────────────────────────────────────────────
  {
    id: "set.frost_scholar",
    name: "Frost Scholar",
    pieceDefIds: [
      "wpn.frostwick",
      "hat.arcane_circlet",
      "top.arcane_robe",
      "bottom.arcane_leggings",
      "shoes.arcane_slippers",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { INT: 3 } },
      { piecesRequired: 3, stats: { INT: 3, mDef: 8 } },
      { piecesRequired: 4, stats: { INT: 4, mDef: 8, mAtk: 6 } },
      { piecesRequired: 5, stats: { INT: 4, mDef: 8, mAtk: 6, MP: 40 } },
    ],
  },

  // ── Mage Lv30 — Sage's Regalia ───────────────────────────────────────────
  {
    id: "set.sages_regalia",
    name: "Sage's Regalia",
    pieceDefIds: [
      "wpn.stormbloom",
      "hat.sage_circlet",
      "top.sage_robe",
      "bottom.sage_leggings",
      "shoes.sage_slippers",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { INT: 4 } },
      { piecesRequired: 3, stats: { INT: 4, mDef: 10, MP: 40 } },
      { piecesRequired: 4, stats: { INT: 5, mDef: 10, mAtk: 8, MP: 40 } },
      { piecesRequired: 5, stats: { INT: 5, mDef: 10, mAtk: 8, MP: 40, critRate: 0.02 } },
    ],
  },

  // ── Mage Lv40 — Mystic Archon ────────────────────────────────────────────
  {
    id: "set.mystic_archon",
    name: "Mystic Archon",
    pieceDefIds: [
      "wpn.celestine_rod",
      "hat.arcane_crown",
      "top.mystic_vestment",
      "bottom.dragonscale_mage_leggings",
      "shoes.dragonscale_mage_treads",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { INT: 5 } },
      { piecesRequired: 3, stats: { INT: 5, mDef: 12, MP: 60 } },
      { piecesRequired: 4, stats: { INT: 6, mDef: 12, mAtk: 10, MP: 60 } },
      {
        piecesRequired: 5,
        stats: { INT: 6, mDef: 12, mAtk: 10, MP: 60, critRate: 0.03, speed: 3 },
      },
    ],
  },

  // ── Mage Lv50 — Obsidian Arcana ──────────────────────────────────────────
  {
    id: "set.obsidian_arcana",
    name: "Obsidian Arcana",
    pieceDefIds: [
      "wpn.voidspire",
      "hat.arcane_diadem",
      "top.obsidian_mage_robe",
      "bottom.obsidian_mage_leggings",
      "shoes.obsidian_mage_treads",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { INT: 6 } },
      { piecesRequired: 3, stats: { INT: 6, mDef: 15, MP: 80 } },
      { piecesRequired: 4, stats: { INT: 7, mDef: 15, mAtk: 12, MP: 80 } },
      {
        piecesRequired: 5,
        stats: { INT: 7, mDef: 15, mAtk: 12, MP: 80, critRate: 0.03, speed: 5 },
      },
    ],
  },

  // ── Mage Lv60 — Celestial Conductor ──────────────────────────────────────
  {
    id: "set.celestial_conductor",
    name: "Celestial Conductor",
    pieceDefIds: [
      "wpn.astral_conductor",
      "hat.celestial_tiara",
      "top.aether_mage_robe",
      "bottom.aethermail_mage_legguards",
      "shoes.aetherbound_mage_greaves",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { INT: 8 } },
      { piecesRequired: 3, stats: { INT: 8, mDef: 18, MP: 100 } },
      { piecesRequired: 4, stats: { INT: 8, mDef: 18, mAtk: 15, MP: 100 } },
      {
        piecesRequired: 5,
        stats: { INT: 10, mDef: 18, mAtk: 15, MP: 100, critRate: 0.05, speed: 5 },
      },
    ],
  },

  // ── Archer Lv20 — Windrunner ─────────────────────────────────────────────
  {
    id: "set.windrunner",
    name: "Windrunner",
    pieceDefIds: [
      "wpn.willowstring",
      "hat.ranger_cap",
      "top.rangers_vest",
      "bottom.rangers_legguards",
      "shoes.rangers_treads",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { DEX: 3 } },
      { piecesRequired: 3, stats: { DEX: 3, wDef: 8 } },
      { piecesRequired: 4, stats: { DEX: 4, wDef: 8, atk: 6 } },
      { piecesRequired: 5, stats: { DEX: 4, wDef: 8, atk: 6, HP: 40 } },
    ],
  },

  // ── Archer Lv30 — Stormbow ───────────────────────────────────────────────
  {
    id: "set.stormbow",
    name: "Stormbow",
    pieceDefIds: [
      "wpn.windpiercer",
      "hat.storm_cap",
      "top.storm_vest",
      "bottom.storm_legguards",
      "shoes.steel_toed_greaves",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { DEX: 4 } },
      { piecesRequired: 3, stats: { DEX: 4, wDef: 10, HP: 40 } },
      { piecesRequired: 4, stats: { DEX: 5, wDef: 10, atk: 8, HP: 40 } },
      { piecesRequired: 5, stats: { DEX: 5, wDef: 10, atk: 8, HP: 40, critRate: 0.02 } },
    ],
  },

  // ── Archer Lv40 — Galeforce ──────────────────────────────────────────────
  {
    id: "set.galeforce",
    name: "Galeforce",
    pieceDefIds: [
      "wpn.skyfire_longbow",
      "hat.gale_helm",
      "top.gale_mantle",
      "bottom.gale_tassets",
      "shoes.gale_treads",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { DEX: 5 } },
      { piecesRequired: 3, stats: { DEX: 5, wDef: 12, HP: 60 } },
      { piecesRequired: 4, stats: { DEX: 6, wDef: 12, atk: 10, HP: 60 } },
      { piecesRequired: 5, stats: { DEX: 6, wDef: 12, atk: 10, HP: 60, critRate: 0.03, speed: 3 } },
    ],
  },

  // ── Archer Lv50 — Dragon Fang ────────────────────────────────────────────
  {
    id: "set.dragon_fang",
    name: "Dragon Fang",
    pieceDefIds: [
      "wpn.zephyrs_reach",
      "hat.storm_helm",
      "top.dragonscale_ranger_mantle",
      "bottom.dragonscale_ranger_tassets",
      "shoes.obsidian_stalkers",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { DEX: 6 } },
      { piecesRequired: 3, stats: { DEX: 6, wDef: 15, HP: 80 } },
      { piecesRequired: 4, stats: { DEX: 7, wDef: 15, atk: 12, HP: 80 } },
      { piecesRequired: 5, stats: { DEX: 7, wDef: 15, atk: 12, HP: 80, critRate: 0.03, speed: 5 } },
    ],
  },

  // ── Archer Lv60 — Aetherwind ─────────────────────────────────────────────
  {
    id: "set.aetherwind",
    name: "Aetherwind",
    pieceDefIds: [
      "wpn.stormcaller",
      "hat.tempest_helm",
      "top.aethermail_ranger_vestment",
      "bottom.aethermail_ranger_legguards",
      "gloves.aetherforged_ranger_gauntlets",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { DEX: 8 } },
      { piecesRequired: 3, stats: { DEX: 8, wDef: 18, HP: 100 } },
      { piecesRequired: 4, stats: { DEX: 8, wDef: 18, atk: 15, HP: 100 } },
      {
        piecesRequired: 5,
        stats: { DEX: 10, wDef: 18, atk: 15, HP: 100, critRate: 0.05, speed: 5 },
      },
    ],
  },

  // ── Thief Lv20 — Nightblade ──────────────────────────────────────────────
  {
    id: "set.nightblade",
    name: "Nightblade",
    pieceDefIds: [
      "wpn.shadow_fang",
      "hat.night_cowl",
      "top.night_jerkin",
      "bottom.rogue_chausses",
      "shoes.night_slippers",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { LUK: 3 } },
      { piecesRequired: 3, stats: { LUK: 3, wDef: 5, HP: 30 } },
      { piecesRequired: 4, stats: { LUK: 4, wDef: 5, atk: 5, HP: 30 } },
      { piecesRequired: 5, stats: { LUK: 4, wDef: 5, atk: 5, HP: 30, speed: 2 } },
    ],
  },

  // ── Thief Lv30 — Eclipse ─────────────────────────────────────────────────
  {
    id: "set.eclipse",
    name: "Eclipse",
    pieceDefIds: [
      "wpn.widows_kiss",
      "hat.rogue_visor",
      "top.rogue_vest",
      "bottom.eclipse_legguards",
      "shoes.rogue_treads",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { LUK: 4 } },
      { piecesRequired: 3, stats: { LUK: 4, wDef: 8, HP: 40 } },
      { piecesRequired: 4, stats: { LUK: 5, wDef: 8, atk: 8, HP: 40 } },
      { piecesRequired: 5, stats: { LUK: 5, wDef: 8, atk: 8, HP: 40, critRate: 0.03 } },
    ],
  },

  // ── Thief Lv40 — Phantom ─────────────────────────────────────────────────
  {
    id: "set.phantom",
    name: "Phantom",
    pieceDefIds: [
      "wpn.soulreaver",
      "hat.eclipse_cowl",
      "top.eclipse_wrap",
      "bottom.night_tassets",
      "shoes.eclipse_treads",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { LUK: 5 } },
      { piecesRequired: 3, stats: { LUK: 5, wDef: 10, HP: 60 } },
      { piecesRequired: 4, stats: { LUK: 6, wDef: 10, atk: 10, HP: 60 } },
      { piecesRequired: 5, stats: { LUK: 6, wDef: 10, atk: 10, HP: 60, critRate: 0.03, speed: 3 } },
    ],
  },

  // ── Thief Lv50 — Obsidian Shadow ─────────────────────────────────────────
  {
    id: "set.obsidian_shadow",
    name: "Obsidian Shadow",
    pieceDefIds: [
      "wpn.eclipse_blade",
      "hat.obsidian_cowl",
      "top.obsidian_rogue_mantle",
      "bottom.obsidian_rogue_tassets",
      "shoes.obsidian_rogue_treads",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { LUK: 6 } },
      { piecesRequired: 3, stats: { LUK: 6, wDef: 12, HP: 80 } },
      { piecesRequired: 4, stats: { LUK: 7, wDef: 12, atk: 12, HP: 80 } },
      { piecesRequired: 5, stats: { LUK: 7, wDef: 12, atk: 12, HP: 80, critRate: 0.03, speed: 5 } },
    ],
  },

  // ── Thief Lv60 — Void Assassin ───────────────────────────────────────────
  {
    id: "set.void_assassin",
    name: "Void Assassin",
    pieceDefIds: [
      "wpn.oblivion_shard",
      "hat.aether_cowl",
      "top.aether_rogue_vestment",
      "bottom.aethermail_rogue_legguards",
      "shoes.aetherbound_rogue_greaves",
    ],
    bonuses: [
      { piecesRequired: 2, stats: { LUK: 8 } },
      { piecesRequired: 3, stats: { LUK: 8, wDef: 15, HP: 100 } },
      { piecesRequired: 4, stats: { LUK: 8, wDef: 15, atk: 15, HP: 100 } },
      {
        piecesRequired: 5,
        stats: { LUK: 10, wDef: 15, atk: 15, HP: 100, critRate: 0.05, speed: 5 },
      },
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a lookup map: defId → setId, built once on first access. */
let _defIdToSet: Map<string, string> | null = null;

function defIdToSet(): Map<string, string> {
  if (_defIdToSet) return _defIdToSet;
  _defIdToSet = new Map();
  for (const set of SETS) {
    for (const defId of set.pieceDefIds) {
      _defIdToSet.set(defId, set.id);
    }
  }
  return _defIdToSet;
}

/**
 * Returns the set id that `defId` belongs to, or `undefined` if it isn't part
 * of any set.
 */
export function setMembership(defId: string): string | undefined {
  return defIdToSet().get(defId);
}

/**
 * Aggregate set bonuses for a collection of equipped defIds.
 *
 * For each set with at least one worn piece, count how many distinct pieces are
 * equipped, then sum every bonus tier whose `piecesRequired ≤ equipped count`.
 *
 * @returns An object with every SecondaryStats + CharacterStats key set to the
 *          total additive bonus (defaults to 0 for unset keys).
 */
export function computeSetBonuses(
  equippedDefIds: readonly string[],
): SecondaryStats & CharacterStats {
  // Accumulate per-set counts (deduplicate so the same item worn twice only counts once)
  const seen = new Set<string>();
  const setCounts = new Map<string, number>();
  for (const defId of equippedDefIds) {
    if (seen.has(defId)) continue;
    seen.add(defId);
    const setId = defIdToSet().get(defId);
    if (setId) {
      setCounts.set(setId, (setCounts.get(setId) ?? 0) + 1);
    }
  }

  // SecondaryStats uses `readonly` fields so we accumulate into a plain
  // mutable mirror and cast on return.
  interface MutableStats {
    atk: number;
    mAtk: number;
    wDef: number;
    mDef: number;
    critRate: number;
    speed: number;
    jump: number;
    accuracy: number;
    avoid: number;
    STR: number;
    DEX: number;
    INT: number;
    LUK: number;
    HP: number;
    MP: number;
  }

  const acc: MutableStats = {
    atk: 0,
    mAtk: 0,
    wDef: 0,
    mDef: 0,
    critRate: 0,
    speed: 0,
    jump: 0,
    accuracy: 0,
    avoid: 0,
    STR: 0,
    DEX: 0,
    INT: 0,
    LUK: 0,
    HP: 0,
    MP: 0,
  };

  for (const set of SETS) {
    const count = setCounts.get(set.id) ?? 0;
    if (count === 0) continue;

    for (const tier of set.bonuses) {
      if (count >= tier.piecesRequired) {
        const s = tier.stats;
        acc.atk += s.atk ?? 0;
        acc.mAtk += s.mAtk ?? 0;
        acc.wDef += s.wDef ?? 0;
        acc.mDef += s.mDef ?? 0;
        acc.critRate += s.critRate ?? 0;
        acc.speed += s.speed ?? 0;
        acc.jump += s.jump ?? 0;
        acc.accuracy += s.accuracy ?? 0;
        acc.avoid += s.avoid ?? 0;
        acc.STR += s.STR ?? 0;
        acc.DEX += s.DEX ?? 0;
        acc.INT += s.INT ?? 0;
        acc.LUK += s.LUK ?? 0;
        acc.HP += s.HP ?? 0;
        acc.MP += s.MP ?? 0;
      }
    }
  }

  return acc;
}
