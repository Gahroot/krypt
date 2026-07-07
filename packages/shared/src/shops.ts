/**
 * Shops — NPC General Store definitions. Each ShopDef defines what a vendor sells
 * (buyPrice) and buys back (sellPrice). Client and server share this as the
 * single source of truth for mesos-based NPC commerce.
 *
 * Distinct from the player-run Free Market (MarketRoom) and the premium
 * Cash Shop (CashItemDef / CASH_ITEMS).
 */

import { ITEMS, type ItemDef, getAmmoDef } from "./items.js";
import { CONSUMABLES, type ConsumableDef } from "./consumables.js";
import { NPCS } from "./npcs.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShopSlot {
  /** Consumable ID (con.*) or equipment item ID (wpn.*, hat.*, top.*). */
  readonly itemId: string;
  /** Mesos the player pays to buy one unit. */
  readonly buyPrice: number;
  /** Mesos the player receives when selling one unit (lower than buyPrice). */
  readonly sellPrice: number;
  /** Optional limited stock — undefined means unlimited. Tracked at runtime by the server. */
  readonly stock?: number;
}

export interface ShopDef {
  readonly id: string;
  readonly name: string;
  /** Primary NPC that operates this shop (used for proximity validation). */
  readonly npcId: string;
  readonly slots: readonly ShopSlot[];
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export const SHOPS: Record<string, ShopDef> = {
  "shop.dawn_basic": {
    id: "shop.dawn_basic",
    name: "Island Merchant Bria's Supplies",
    npcId: "npc.dawn_shop",
    slots: [
      { itemId: "pot.small_hp", buyPrice: 20, sellPrice: 5 },
      { itemId: "pot.medium_hp", buyPrice: 40, sellPrice: 10 },
      { itemId: "pot.small_mp", buyPrice: 25, sellPrice: 6 },
      { itemId: "pot.medium_mp", buyPrice: 50, sellPrice: 12 },
      { itemId: "scroll.return", buyPrice: 300, sellPrice: 75 },
      { itemId: "ammo.shortbow_arrow", buyPrice: 5, sellPrice: 1 },
      { itemId: "ammo.lead_bullet", buyPrice: 5, sellPrice: 1 },
      { itemId: "ammo.iron_star", buyPrice: 5, sellPrice: 1 },
      { itemId: "wpn.bronze_shortsword", buyPrice: 200, sellPrice: 50 },
    ],
  },
  "shop.meadow_basic": {
    id: "shop.meadow_basic",
    name: "Merchant Bram's General Store",
    npcId: "npc.meadow_shop",
    slots: [
      { itemId: "con.hp_potion_s", buyPrice: 20, sellPrice: 5 },
      { itemId: "con.hp_potion_m", buyPrice: 60, sellPrice: 15 },
      { itemId: "con.mp_potion_s", buyPrice: 25, sellPrice: 6 },
      { itemId: "con.mp_potion_m", buyPrice: 75, sellPrice: 18 },
      { itemId: "con.return_scroll", buyPrice: 300, sellPrice: 75 },
      { itemId: "ammo.shortbow_arrow", buyPrice: 5, sellPrice: 1 },
      { itemId: "ammo.lead_bullet", buyPrice: 5, sellPrice: 1 },
      { itemId: "ammo.iron_star", buyPrice: 5, sellPrice: 1 },
      { itemId: "wpn.bronze_shortsword", buyPrice: 200, sellPrice: 50 },
      { itemId: "hat.leather_cap", buyPrice: 150, sellPrice: 37 },
      { itemId: "top.traveler_jerkin", buyPrice: 250, sellPrice: 62 },
    ],
  },
  "shop.harbor_basics": {
    id: "shop.harbor_basics",
    name: "Dock Trader's Supplies",
    npcId: "npc.harbor_shop",
    slots: [
      { itemId: "con.hp_potion_s", buyPrice: 20, sellPrice: 5 },
      { itemId: "con.hp_potion_m", buyPrice: 60, sellPrice: 15 },
      { itemId: "con.mp_potion_s", buyPrice: 25, sellPrice: 6 },
      { itemId: "con.mp_potion_m", buyPrice: 75, sellPrice: 18 },
      { itemId: "con.return_scroll", buyPrice: 300, sellPrice: 75 },
      { itemId: "ammo.shortbow_arrow", buyPrice: 5, sellPrice: 1 },
      { itemId: "ammo.lead_bullet", buyPrice: 5, sellPrice: 1 },
      { itemId: "ammo.iron_star", buyPrice: 5, sellPrice: 1 },
      { itemId: "wpn.bronze_shortsword", buyPrice: 200, sellPrice: 50 },
    ],
  },
  "shop.harbor_equip": {
    id: "shop.harbor_equip",
    name: "Harbor Weaponsmith",
    npcId: "npc.harbor_potion_vendor",
    slots: [
      { itemId: "wpn.iron_broadsword", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.oak_maul", buyPrice: 850, sellPrice: 212 },
      { itemId: "wpn.ember_wand", buyPrice: 750, sellPrice: 187 },
      { itemId: "wpn.oakwood_staff", buyPrice: 750, sellPrice: 187 },
      { itemId: "wpn.gale_bow", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.hardwood_crossbow", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.nightfang_dagger", buyPrice: 700, sellPrice: 175 },
      { itemId: "wpn.iron_talon", buyPrice: 700, sellPrice: 175 },
      { itemId: "wpn.tidebreaker_gun", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.copper_knuckle", buyPrice: 750, sellPrice: 187 },
      { itemId: "ammo.shortbow_arrow", buyPrice: 5, sellPrice: 1 },
      { itemId: "ammo.lead_bullet", buyPrice: 5, sellPrice: 1 },
      { itemId: "ammo.iron_star", buyPrice: 5, sellPrice: 1 },
      { itemId: "hat.leather_cap", buyPrice: 150, sellPrice: 37 },
      { itemId: "hat.woven_circlet", buyPrice: 200, sellPrice: 50 },
      { itemId: "hat.tattered_hood", buyPrice: 100, sellPrice: 25 },
      { itemId: "top.traveler_jerkin", buyPrice: 250, sellPrice: 62 },
      { itemId: "top.mages_robe", buyPrice: 300, sellPrice: 75 },
      { itemId: "bottom.leather_greaves", buyPrice: 200, sellPrice: 50 },
      { itemId: "shoes.worn_boots", buyPrice: 150, sellPrice: 37 },
      { itemId: "gloves.leather_bracers", buyPrice: 120, sellPrice: 30 },
      { itemId: "gloves.mages_mitts", buyPrice: 180, sellPrice: 45 },
      { itemId: "shield.iron_buckler", buyPrice: 250, sellPrice: 62 },
      { itemId: "cape.travelers_mantle", buyPrice: 180, sellPrice: 45 },
      { itemId: "belt.twine_sash", buyPrice: 100, sellPrice: 25 },
    ],
  },
  "shop.meadow_equip": {
    id: "shop.meadow_equip",
    name: "Ranger Outfitter",
    npcId: "npc.meadow_potion_vendor",
    slots: [
      { itemId: "wpn.iron_broadsword", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.oak_maul", buyPrice: 850, sellPrice: 212 },
      { itemId: "wpn.ember_wand", buyPrice: 750, sellPrice: 187 },
      { itemId: "wpn.oakwood_staff", buyPrice: 750, sellPrice: 187 },
      { itemId: "wpn.gale_bow", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.hardwood_crossbow", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.nightfang_dagger", buyPrice: 700, sellPrice: 175 },
      { itemId: "wpn.iron_talon", buyPrice: 700, sellPrice: 175 },
      { itemId: "wpn.tidebreaker_gun", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.copper_knuckle", buyPrice: 750, sellPrice: 187 },
      // ── Ammo ──────────────────────────────────────────────
      { itemId: "ammo.shortbow_arrow", buyPrice: 5, sellPrice: 1 },
      { itemId: "ammo.lead_bullet", buyPrice: 5, sellPrice: 1 },
      { itemId: "ammo.iron_star", buyPrice: 5, sellPrice: 1 },
      // ── Archer (DEX) starters ────────────────────────────
      { itemId: "hat.gale_cap", buyPrice: 80, sellPrice: 20 },
      { itemId: "hat.wind_cap", buyPrice: 150, sellPrice: 37 },
      { itemId: "top.leather_jerkin", buyPrice: 100, sellPrice: 25 },
      { itemId: "top.wind_jerkin", buyPrice: 200, sellPrice: 50 },
      { itemId: "bottom.leather_leggings", buyPrice: 80, sellPrice: 20 },
      { itemId: "bottom.wind_greaves", buyPrice: 150, sellPrice: 37 },
      { itemId: "gloves.gale_wraps", buyPrice: 80, sellPrice: 20 },
      { itemId: "gloves.wind_bracers", buyPrice: 120, sellPrice: 30 },
      { itemId: "shoes.worn_boots", buyPrice: 150, sellPrice: 37 },
      { itemId: "cape.worn_shawl", buyPrice: 80, sellPrice: 20 },
      { itemId: "cape.travelers_mantle", buyPrice: 180, sellPrice: 45 },
      // ── Mage (INT) starters ──────────────────────────────
      { itemId: "hat.arcane_apprentice_hood", buyPrice: 80, sellPrice: 20 },
      { itemId: "hat.woven_circlet", buyPrice: 200, sellPrice: 50 },
      { itemId: "top.arcane_apprentice_robe", buyPrice: 100, sellPrice: 25 },
      { itemId: "top.mages_robe", buyPrice: 300, sellPrice: 75 },
      { itemId: "bottom.mages_leggings", buyPrice: 150, sellPrice: 37 },
      { itemId: "gloves.mages_gloves", buyPrice: 100, sellPrice: 25 },
      { itemId: "gloves.mages_mitts", buyPrice: 180, sellPrice: 45 },
      { itemId: "shoes.mages_slippers", buyPrice: 120, sellPrice: 30 },
      { itemId: "cape.mages_shawl", buyPrice: 120, sellPrice: 30 },
      // ── Thief (LUK) starters ─────────────────────────────
      { itemId: "hat.shadow_hood", buyPrice: 80, sellPrice: 20 },
      { itemId: "hat.night_cowl", buyPrice: 150, sellPrice: 37 },
      { itemId: "top.shadow_wrap", buyPrice: 100, sellPrice: 25 },
      { itemId: "top.night_jerkin", buyPrice: 200, sellPrice: 50 },
      { itemId: "bottom.shadow_leggings", buyPrice: 80, sellPrice: 20 },
      { itemId: "bottom.night_greaves", buyPrice: 150, sellPrice: 37 },
      { itemId: "gloves.shadow_wraps", buyPrice: 80, sellPrice: 20 },
      { itemId: "gloves.night_bracers", buyPrice: 120, sellPrice: 30 },
      { itemId: "shoes.shadow_slippers", buyPrice: 80, sellPrice: 20 },
      { itemId: "shoes.night_slippers", buyPrice: 150, sellPrice: 37 },
      { itemId: "cape.shadow_shawl", buyPrice: 80, sellPrice: 20 },
      { itemId: "cape.night_mantle", buyPrice: 120, sellPrice: 30 },
      // ── Warrior (STR) + misc ─────────────────────────────
      { itemId: "hat.leather_cap", buyPrice: 150, sellPrice: 37 },
      { itemId: "hat.tattered_hood", buyPrice: 100, sellPrice: 25 },
      { itemId: "top.traveler_jerkin", buyPrice: 250, sellPrice: 62 },
      { itemId: "bottom.leather_greaves", buyPrice: 200, sellPrice: 50 },
      { itemId: "gloves.leather_bracers", buyPrice: 120, sellPrice: 30 },
      { itemId: "shield.iron_buckler", buyPrice: 250, sellPrice: 62 },
      { itemId: "belt.twine_sash", buyPrice: 100, sellPrice: 25 },
      { itemId: "earring.willowstuds", buyPrice: 200, sellPrice: 50 },
      { itemId: "pendant.tarnished_amulet", buyPrice: 250, sellPrice: 62 },
      { itemId: "face.wooden_mask", buyPrice: 200, sellPrice: 50 },
    ],
  },
  "shop.sylvan_general": {
    id: "shop.sylvan_general",
    name: "Canopy Provisioner",
    npcId: "npc.sylvan_shop",
    slots: [
      { itemId: "con.hp_potion_s", buyPrice: 20, sellPrice: 5 },
      { itemId: "con.hp_potion_m", buyPrice: 60, sellPrice: 15 },
      { itemId: "con.mp_potion_s", buyPrice: 25, sellPrice: 6 },
      { itemId: "con.mp_potion_m", buyPrice: 75, sellPrice: 18 },
      { itemId: "con.return_scroll", buyPrice: 300, sellPrice: 75 },
      { itemId: "buff.power_elixir", buyPrice: 500, sellPrice: 125 },
      { itemId: "buff.swiftfoot_tonic", buyPrice: 400, sellPrice: 100 },
    ],
  },
  "shop.sylvan_equip": {
    id: "shop.sylvan_equip",
    name: "Sylvan Arcane Depot",
    npcId: "npc.sylvan_potion_vendor",
    slots: [
      { itemId: "wpn.ember_wand", buyPrice: 750, sellPrice: 187 },
      { itemId: "wpn.oakwood_staff", buyPrice: 750, sellPrice: 187 },
      { itemId: "wpn.nightfang_dagger", buyPrice: 700, sellPrice: 175 },
      { itemId: "wpn.iron_talon", buyPrice: 700, sellPrice: 175 },
      // ── Mage (INT) starters ──────────────────────────────
      { itemId: "hat.arcane_apprentice_hood", buyPrice: 80, sellPrice: 20 },
      { itemId: "hat.woven_circlet", buyPrice: 200, sellPrice: 50 },
      { itemId: "top.arcane_apprentice_robe", buyPrice: 100, sellPrice: 25 },
      { itemId: "top.mages_robe", buyPrice: 300, sellPrice: 75 },
      { itemId: "bottom.arcane_apprentice_leggings", buyPrice: 80, sellPrice: 20 },
      { itemId: "bottom.mages_leggings", buyPrice: 150, sellPrice: 37 },
      { itemId: "gloves.arcane_apprentice_wraps", buyPrice: 80, sellPrice: 20 },
      { itemId: "gloves.mages_gloves", buyPrice: 100, sellPrice: 25 },
      { itemId: "gloves.mages_mitts", buyPrice: 180, sellPrice: 45 },
      { itemId: "shoes.arcane_apprentice_slippers", buyPrice: 80, sellPrice: 20 },
      { itemId: "shoes.mages_slippers", buyPrice: 120, sellPrice: 30 },
      { itemId: "cape.arcane_apprentice_shawl", buyPrice: 80, sellPrice: 20 },
      { itemId: "cape.mages_shawl", buyPrice: 120, sellPrice: 30 },
      { itemId: "overall.arcane_apprentice_overalls", buyPrice: 100, sellPrice: 25 },
      { itemId: "overall.mages_overalls", buyPrice: 200, sellPrice: 50 },
      // ── Thief (LUK) starters ─────────────────────────────
      { itemId: "hat.shadow_hood", buyPrice: 80, sellPrice: 20 },
      { itemId: "hat.night_cowl", buyPrice: 150, sellPrice: 37 },
      { itemId: "top.shadow_wrap", buyPrice: 100, sellPrice: 25 },
      { itemId: "bottom.shadow_leggings", buyPrice: 80, sellPrice: 20 },
      { itemId: "gloves.shadow_wraps", buyPrice: 80, sellPrice: 20 },
      { itemId: "shoes.shadow_slippers", buyPrice: 80, sellPrice: 20 },
      { itemId: "cape.shadow_shawl", buyPrice: 80, sellPrice: 20 },
      { itemId: "pendant.tarnished_amulet", buyPrice: 250, sellPrice: 62 },
      { itemId: "eye.crude_monocle", buyPrice: 200, sellPrice: 50 },
      { itemId: "belt.twine_sash", buyPrice: 100, sellPrice: 25 },
      { itemId: "shoulder.padded_mantle", buyPrice: 200, sellPrice: 50 },
    ],
  },
  "shop.crag_general": {
    id: "shop.crag_general",
    name: "Forge Provisions",
    npcId: "npc.crag_shop",
    slots: [
      { itemId: "con.hp_potion_s", buyPrice: 20, sellPrice: 5 },
      { itemId: "con.hp_potion_m", buyPrice: 60, sellPrice: 15 },
      { itemId: "con.mp_potion_s", buyPrice: 25, sellPrice: 6 },
      { itemId: "con.mp_potion_m", buyPrice: 75, sellPrice: 18 },
      { itemId: "con.return_scroll", buyPrice: 300, sellPrice: 75 },
      { itemId: "buff.power_elixir", buyPrice: 500, sellPrice: 125 },
      { itemId: "buff.swiftfoot_tonic", buyPrice: 400, sellPrice: 100 },
    ],
  },
  "shop.crag_equip": {
    id: "shop.crag_equip",
    name: "Craghold Armory",
    npcId: "npc.crag_potion_vendor",
    slots: [
      { itemId: "wpn.iron_broadsword", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.oak_maul", buyPrice: 850, sellPrice: 212 },
      { itemId: "wpn.tidebreaker_gun", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.copper_knuckle", buyPrice: 750, sellPrice: 187 },
      // ── Ammo ──────────────────────────────────────────────
      { itemId: "ammo.hunters_arrow", buyPrice: 12, sellPrice: 3 },
      { itemId: "ammo.hollow_bullet", buyPrice: 12, sellPrice: 3 },
      { itemId: "ammo.steel_star", buyPrice: 12, sellPrice: 3 },
      { itemId: "hat.tattered_hood", buyPrice: 100, sellPrice: 25 },
      { itemId: "hat.leather_cap", buyPrice: 150, sellPrice: 37 },
      { itemId: "top.traveler_jerkin", buyPrice: 250, sellPrice: 62 },
      { itemId: "top.patchwork_vest", buyPrice: 100, sellPrice: 25 },
      { itemId: "bottom.leather_greaves", buyPrice: 200, sellPrice: 50 },
      { itemId: "bottom.burlap_leggings", buyPrice: 80, sellPrice: 20 },
      { itemId: "shoes.worn_boots", buyPrice: 150, sellPrice: 37 },
      { itemId: "gloves.leather_bracers", buyPrice: 120, sellPrice: 30 },
      { itemId: "gloves.ragged_wraps", buyPrice: 80, sellPrice: 20 },
      { itemId: "shield.wicker_shield", buyPrice: 100, sellPrice: 25 },
      { itemId: "shield.iron_buckler", buyPrice: 250, sellPrice: 62 },
      { itemId: "cape.travelers_mantle", buyPrice: 180, sellPrice: 45 },
      { itemId: "overall.burlap_wraps", buyPrice: 80, sellPrice: 20 },
      { itemId: "overall.hide_overalls", buyPrice: 200, sellPrice: 50 },
      { itemId: "belt.twine_sash", buyPrice: 100, sellPrice: 25 },
      { itemId: "shoulder.padded_mantle", buyPrice: 200, sellPrice: 50 },
    ],
  },
  "shop.dusk_general": {
    id: "shop.dusk_general",
    name: "Neon Street Market",
    npcId: "npc.dusk_shop",
    slots: [
      { itemId: "con.hp_potion_s", buyPrice: 20, sellPrice: 5 },
      { itemId: "con.hp_potion_m", buyPrice: 60, sellPrice: 15 },
      { itemId: "con.mp_potion_s", buyPrice: 25, sellPrice: 6 },
      { itemId: "con.mp_potion_m", buyPrice: 75, sellPrice: 18 },
      { itemId: "con.return_scroll", buyPrice: 300, sellPrice: 75 },
      { itemId: "buff.power_elixir", buyPrice: 500, sellPrice: 125 },
      { itemId: "buff.swiftfoot_tonic", buyPrice: 400, sellPrice: 100 },
    ],
  },
  "shop.dusk_equip": {
    id: "shop.dusk_equip",
    name: "Shadow Blade Emporium",
    npcId: "npc.dusk_potion_vendor",
    slots: [
      // ── Thief (LUK) starters ─────────────────────────────
      { itemId: "wpn.nightfang_dagger", buyPrice: 700, sellPrice: 175 },
      { itemId: "wpn.iron_talon", buyPrice: 700, sellPrice: 175 },
      { itemId: "hat.shadow_hood", buyPrice: 80, sellPrice: 20 },
      { itemId: "hat.night_cowl", buyPrice: 150, sellPrice: 37 },
      { itemId: "top.shadow_wrap", buyPrice: 100, sellPrice: 25 },
      { itemId: "top.night_jerkin", buyPrice: 200, sellPrice: 50 },
      { itemId: "bottom.shadow_leggings", buyPrice: 80, sellPrice: 20 },
      { itemId: "bottom.night_greaves", buyPrice: 150, sellPrice: 37 },
      { itemId: "gloves.shadow_wraps", buyPrice: 80, sellPrice: 20 },
      { itemId: "gloves.night_bracers", buyPrice: 120, sellPrice: 30 },
      { itemId: "shoes.shadow_slippers", buyPrice: 80, sellPrice: 20 },
      { itemId: "shoes.night_slippers", buyPrice: 150, sellPrice: 37 },
      { itemId: "cape.shadow_shawl", buyPrice: 80, sellPrice: 20 },
      { itemId: "cape.night_mantle", buyPrice: 120, sellPrice: 30 },
      { itemId: "overall.shadow_overalls", buyPrice: 100, sellPrice: 25 },
      { itemId: "overall.night_overalls", buyPrice: 200, sellPrice: 50 },
      // ── Mage (INT) starters ──────────────────────────────
      { itemId: "wpn.ember_wand", buyPrice: 750, sellPrice: 187 },
      { itemId: "hat.arcane_apprentice_hood", buyPrice: 80, sellPrice: 20 },
      { itemId: "hat.woven_circlet", buyPrice: 200, sellPrice: 50 },
      { itemId: "top.arcane_apprentice_robe", buyPrice: 100, sellPrice: 25 },
      { itemId: "top.mages_robe", buyPrice: 300, sellPrice: 75 },
      { itemId: "bottom.arcane_apprentice_leggings", buyPrice: 80, sellPrice: 20 },
      { itemId: "gloves.arcane_apprentice_wraps", buyPrice: 80, sellPrice: 20 },
      { itemId: "shoes.arcane_apprentice_slippers", buyPrice: 80, sellPrice: 20 },
      { itemId: "cape.arcane_apprentice_shawl", buyPrice: 80, sellPrice: 20 },
      { itemId: "belt.twine_sash", buyPrice: 100, sellPrice: 25 },
      { itemId: "earring.willowstuds", buyPrice: 200, sellPrice: 50 },
      { itemId: "face.wooden_mask", buyPrice: 200, sellPrice: 50 },
    ],
  },
  "shop.mirefen_general": {
    id: "shop.mirefen_general",
    name: "Bog Merchant's Wares",
    npcId: "npc.mirefen_shop",
    slots: [
      { itemId: "con.hp_potion_s", buyPrice: 20, sellPrice: 5 },
      { itemId: "con.hp_potion_m", buyPrice: 60, sellPrice: 15 },
      { itemId: "con.mp_potion_s", buyPrice: 25, sellPrice: 6 },
      { itemId: "con.mp_potion_m", buyPrice: 75, sellPrice: 18 },
      { itemId: "con.return_scroll", buyPrice: 300, sellPrice: 75 },
      { itemId: "buff.power_elixir", buyPrice: 500, sellPrice: 125 },
      { itemId: "buff.swiftfoot_tonic", buyPrice: 400, sellPrice: 100 },
      { itemId: "buff.arcane_draught", buyPrice: 800, sellPrice: 200, stock: 10 },
    ],
  },
  "shop.mirefen_equip": {
    id: "shop.mirefen_equip",
    name: "Mirefen Ruin Relics",
    npcId: "npc.mirefen_potion_vendor",
    slots: [
      { itemId: "wpn.steel_fang", buyPrice: 2400, sellPrice: 600 },
      { itemId: "wpn.iron_bell", buyPrice: 2500, sellPrice: 625 },
      { itemId: "wpn.frostwick", buyPrice: 2200, sellPrice: 550 },
      { itemId: "wpn.serpent_spine", buyPrice: 2200, sellPrice: 550 },
      { itemId: "wpn.willowstring", buyPrice: 2400, sellPrice: 600 },
      { itemId: "wpn.ironstring", buyPrice: 2400, sellPrice: 600 },
      { itemId: "wpn.shadow_fang", buyPrice: 2200, sellPrice: 550 },
      { itemId: "wpn.ravens_grip", buyPrice: 2200, sellPrice: 550 },
      { itemId: "wpn.thunderpipe", buyPrice: 2400, sellPrice: 600 },
      { itemId: "wpn.stormfist", buyPrice: 2400, sellPrice: 600 },
      { itemId: "hat.iron_crest_helm", buyPrice: 600, sellPrice: 150 },
      { itemId: "hat.rogue_cowl", buyPrice: 500, sellPrice: 125 },
      { itemId: "top.chainmail_tunic", buyPrice: 800, sellPrice: 200 },
      { itemId: "top.rogues_wrap", buyPrice: 600, sellPrice: 150 },
      { itemId: "bottom.steel_chausses", buyPrice: 500, sellPrice: 125 },
      { itemId: "shoes.ironclad_sabatons", buyPrice: 500, sellPrice: 125 },
      { itemId: "shoes.windwalker_slippers", buyPrice: 600, sellPrice: 150 },
      { itemId: "gloves.chainmail_gauntlets", buyPrice: 400, sellPrice: 100 },
      { itemId: "gloves.mages_mitts", buyPrice: 400, sellPrice: 100 },
      { itemId: "shield.steel_rondel", buyPrice: 600, sellPrice: 150 },
      { itemId: "cape.wardens_cloak", buyPrice: 400, sellPrice: 100 },
      { itemId: "cape.archers_windcloak", buyPrice: 500, sellPrice: 125 },
      { itemId: "overall.chainmail_overalls", buyPrice: 700, sellPrice: 175 },
    ],
  },
  "shop.crossway_general": {
    id: "shop.crossway_general",
    name: "Crossroads Trading Post",
    npcId: "npc.crossway_shop",
    slots: [
      { itemId: "con.hp_potion_s", buyPrice: 20, sellPrice: 5 },
      { itemId: "con.hp_potion_m", buyPrice: 60, sellPrice: 15 },
      { itemId: "con.mp_potion_s", buyPrice: 25, sellPrice: 6 },
      { itemId: "con.mp_potion_m", buyPrice: 75, sellPrice: 18 },
      { itemId: "con.return_scroll", buyPrice: 300, sellPrice: 75 },
      { itemId: "buff.power_elixir", buyPrice: 500, sellPrice: 125 },
      { itemId: "buff.swiftfoot_tonic", buyPrice: 400, sellPrice: 100 },
      { itemId: "buff.arcane_draught", buyPrice: 800, sellPrice: 200, stock: 5 },
    ],
  },
  "shop.crossway_equip": {
    id: "shop.crossway_equip",
    name: "World Tree Armory",
    npcId: "npc.crossway_potion_vendor",
    slots: [
      { itemId: "wpn.iron_broadsword", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.oak_maul", buyPrice: 850, sellPrice: 212 },
      { itemId: "wpn.ember_wand", buyPrice: 750, sellPrice: 187 },
      { itemId: "wpn.oakwood_staff", buyPrice: 750, sellPrice: 187 },
      { itemId: "wpn.gale_bow", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.hardwood_crossbow", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.nightfang_dagger", buyPrice: 700, sellPrice: 175 },
      { itemId: "wpn.iron_talon", buyPrice: 700, sellPrice: 175 },
      { itemId: "wpn.tidebreaker_gun", buyPrice: 800, sellPrice: 200 },
      { itemId: "wpn.copper_knuckle", buyPrice: 750, sellPrice: 187 },
      // ── Warrior (STR) starters ─────────────────────────────
      { itemId: "hat.tattered_hood", buyPrice: 100, sellPrice: 25 },
      { itemId: "hat.leather_cap", buyPrice: 150, sellPrice: 37 },
      { itemId: "top.traveler_jerkin", buyPrice: 250, sellPrice: 62 },
      { itemId: "top.patchwork_vest", buyPrice: 100, sellPrice: 25 },
      { itemId: "bottom.leather_greaves", buyPrice: 200, sellPrice: 50 },
      { itemId: "bottom.burlap_leggings", buyPrice: 80, sellPrice: 20 },
      { itemId: "gloves.leather_bracers", buyPrice: 120, sellPrice: 30 },
      { itemId: "gloves.ragged_wraps", buyPrice: 80, sellPrice: 20 },
      { itemId: "shoes.worn_boots", buyPrice: 150, sellPrice: 37 },
      { itemId: "shield.iron_buckler", buyPrice: 250, sellPrice: 62 },
      { itemId: "cape.travelers_mantle", buyPrice: 180, sellPrice: 45 },
      { itemId: "overall.burlap_wraps", buyPrice: 80, sellPrice: 20 },
      { itemId: "overall.hide_overalls", buyPrice: 200, sellPrice: 50 },
      // ── Mage (INT) starters ──────────────────────────────
      { itemId: "hat.arcane_apprentice_hood", buyPrice: 80, sellPrice: 20 },
      { itemId: "hat.woven_circlet", buyPrice: 200, sellPrice: 50 },
      { itemId: "top.arcane_apprentice_robe", buyPrice: 100, sellPrice: 25 },
      { itemId: "top.mages_robe", buyPrice: 300, sellPrice: 75 },
      { itemId: "bottom.mages_leggings", buyPrice: 150, sellPrice: 37 },
      { itemId: "gloves.mages_gloves", buyPrice: 100, sellPrice: 25 },
      { itemId: "gloves.mages_mitts", buyPrice: 180, sellPrice: 45 },
      { itemId: "shoes.mages_slippers", buyPrice: 120, sellPrice: 30 },
      { itemId: "cape.mages_shawl", buyPrice: 120, sellPrice: 30 },
      { itemId: "overall.mages_overalls", buyPrice: 200, sellPrice: 50 },
      // ── Archer (DEX) starters ────────────────────────────
      { itemId: "hat.gale_cap", buyPrice: 80, sellPrice: 20 },
      { itemId: "hat.wind_cap", buyPrice: 150, sellPrice: 37 },
      { itemId: "top.wind_jerkin", buyPrice: 200, sellPrice: 50 },
      { itemId: "bottom.wind_greaves", buyPrice: 150, sellPrice: 37 },
      { itemId: "gloves.wind_bracers", buyPrice: 120, sellPrice: 30 },
      { itemId: "cape.worn_shawl", buyPrice: 80, sellPrice: 20 },
      { itemId: "overall.wind_overalls", buyPrice: 200, sellPrice: 50 },
      // ── Thief (LUK) starters ─────────────────────────────
      { itemId: "hat.night_cowl", buyPrice: 150, sellPrice: 37 },
      { itemId: "top.night_jerkin", buyPrice: 200, sellPrice: 50 },
      { itemId: "bottom.night_greaves", buyPrice: 150, sellPrice: 37 },
      { itemId: "gloves.night_bracers", buyPrice: 120, sellPrice: 30 },
      { itemId: "shoes.night_slippers", buyPrice: 150, sellPrice: 37 },
      { itemId: "cape.night_mantle", buyPrice: 120, sellPrice: 30 },
      { itemId: "overall.night_overalls", buyPrice: 200, sellPrice: 50 },
      // ── Misc ─────────────────────────────────────────────
      { itemId: "belt.twine_sash", buyPrice: 100, sellPrice: 25 },
      { itemId: "earring.willowstuds", buyPrice: 200, sellPrice: 50 },
      { itemId: "pendant.tarnished_amulet", buyPrice: 250, sellPrice: 62 },
      { itemId: "face.wooden_mask", buyPrice: 200, sellPrice: 50 },
    ],
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getShopDef(shopId: string): ShopDef | undefined {
  return SHOPS[shopId];
}

/**
 * Look up the sell price for any item across all shops.
 * Returns the sellPrice from the first shop slot that matches, or undefined
 * if no shop buys this item.
 */
export function getItemSellPrice(itemId: string): number | undefined {
  for (const shop of Object.values(SHOPS)) {
    for (const slot of shop.slots) {
      if (slot.itemId === itemId) return slot.sellPrice;
    }
  }
  return undefined;
}

/**
 * Resolve the display name for a shop slot's item.
 * Handles both consumable IDs and equipment IDs.
 */
export function getShopItemName(itemId: string): string {
  const conDef: ConsumableDef | undefined = CONSUMABLES[itemId];
  if (conDef) return conDef.name;
  const ammoDef = getAmmoDef(itemId);
  if (ammoDef) return ammoDef.name;
  const itemDef: ItemDef | undefined = ITEMS[itemId];
  if (itemDef) return itemDef.name;
  return itemId;
}

/** Convenience alias — sell price as a fraction of the shop's buy price. */
export function sellPriceFor(defId: string): number | undefined {
  return getItemSellPrice(defId);
}

/** Reverse lookup: all NPC ids that offer a given shop id. */
export function getShopNpcIds(shopId: string): readonly string[] {
  const npcIds: string[] = [];
  for (const npc of Object.values(NPCS)) {
    for (const node of npc.dialog) {
      const action = node.kind === "line" ? node.action : undefined;
      if (action && action.kind === "openShop" && action.payload === shopId) {
        npcIds.push(npc.id);
        break; // one match per NPC is enough
      }
      if (node.kind === "branch") {
        for (const choice of node.choices) {
          if (
            choice.action &&
            choice.action.kind === "openShop" &&
            choice.action.payload === shopId
          ) {
            npcIds.push(npc.id);
            break;
          }
        }
      }
    }
  }
  return npcIds;
}
