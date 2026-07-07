/**
 * Quests — definitions for the quest system.
 *
 * Each quest has a set of objectives (a discriminated union) and concrete rewards.
 * Quests are keyed by stable string ids so both server and client can reference them
 * without hard-coding.
 *
 * Progression chain (Lv 1 → 70):
 *   Dawn Isle → Tidewatch Harbor → Heartland towns → Crossway → Mirefen → Skyhaven → Frosthold
 *
 * Repeatable quests (daily reset):
 *   Each region has 2 daily quests (hunt + collect) that reset at UTC midnight.
 *   A rotating "Bonus Hunting" map grants extra EXP/drops for all players.
 */

// ---------------------------------------------------------------------------
// Objective types (discriminated union)
// ---------------------------------------------------------------------------

export interface KillObjective {
  readonly kind: "kill";
  readonly mobId: string;
  readonly count: number;
}

export interface CollectObjective {
  readonly kind: "collect";
  readonly itemId: string;
  readonly count: number;
}

export interface TalkObjective {
  readonly kind: "talk";
  readonly npcId: string;
}

export interface LevelObjective {
  readonly kind: "level";
  readonly level: number;
}

/** Break a reactor (ore vein, breakable box, etc.) by attack damage. */
export interface BreakObjective {
  readonly kind: "break";
  /** Reactor kind to match (e.g. "ore-vein", "breakable-box"). Omit to match any. */
  readonly reactorKind?: string;
  readonly count: number;
}

/** Interact with a reactor (quest switch, mechanism, etc.). */
export interface InteractObjective {
  readonly kind: "interact";
  /** Reactor kind to match (e.g. "quest-switch", "mechanism"). Omit to match any. */
  readonly reactorKind?: string;
  readonly count: number;
}

/** Any quest objective. Narrow with `obj.kind` before accessing kind-specific fields. */
export type Objective =
  | KillObjective
  | CollectObjective
  | TalkObjective
  | LevelObjective
  | BreakObjective
  | InteractObjective;

// ---------------------------------------------------------------------------
// Quest definitions
// ---------------------------------------------------------------------------

export interface QuestRewards {
  readonly mesos?: number;
  readonly exp?: number;
  /** Item ids — must resolve to keys in the ITEMS catalog. */
  readonly items?: readonly string[];
  /**
   * Class-conditional item rewards keyed by ClassArchetype name.
   * When set, the matching entry is granted in addition to the flat `items`
   * array — so each class receives its appropriate starter weapon.
   */
  readonly classRewards?: Readonly<Record<string, readonly string[]>>;
  /**
   * When set the server should advance the player's job tier to this value.
   * Used by job-advancement quest chains so the quest system drives the
   * promotion rather than an NPC dialog action.
   */
  readonly jobAdvanceToTier?: number;
}

export interface QuestDef {
  readonly id: string;
  readonly name: string;
  /** NPC who gives this quest — must resolve to a key in the NPCS catalog. */
  readonly giverNpcId: string;
  /** Minimum player level to accept the quest (omit for no requirement). */
  readonly requiredLevel?: number;
  /** Quest id that must be completed before this quest becomes available. */
  readonly prereqQuestId?: string;
  readonly objectives: readonly Objective[];
  readonly rewards: QuestRewards;
  /**
   * Repeatability policy. When set the quest resets after the given cadence.
   * `"daily"` — resets at UTC midnight each day.
   */
  readonly repeatable?: { readonly kind: "daily" };
}

// ---------------------------------------------------------------------------
// Per-character quest runtime state
// ---------------------------------------------------------------------------

export type QuestStatus = "available" | "active" | "complete" | "turnedIn";

/** Runtime progress for a single objective within an active quest. */
export interface ObjectiveProgress {
  readonly kind: string;
  current: number;
  readonly target: number;
}

/** A snapshot of one quest's state for a single character. Persisted in CharacterRecord. */
export interface QuestState {
  questId: string;
  status: QuestStatus;
  objectiveProgress: ObjectiveProgress[];
  /** Epoch-ms timestamp when this quest was last turned in. Used for daily-reset tracking. */
  lastTurnedInAt?: number;
}

// ---------------------------------------------------------------------------
// Quest catalog
// ---------------------------------------------------------------------------

export const QUESTS: Record<string, QuestDef> = {
  // ── Dawn Isle tutorial chain (Lv 1–8) ──────────────────────────────────

  /** Q1: Talk to Guide Iris — introduces the world. */
  "quest.dawn_tutorial": {
    id: "quest.dawn_tutorial",
    name: "A Friendly Welcome",
    giverNpcId: "npc.dawn_guide",
    objectives: [{ kind: "talk", npcId: "npc.dawn_guide" }],
    rewards: { mesos: 50, exp: 40 },
  },

  /** Q2: Kill 5 starter mobs — learn to fight. */
  "quest.dawn_trio": {
    id: "quest.dawn_trio",
    name: "Pest Control",
    giverNpcId: "npc.dawn_guide",
    requiredLevel: 1,
    prereqQuestId: "quest.dawn_tutorial",
    objectives: [{ kind: "kill", mobId: "mob.friendly_snail", count: 5 }],
    rewards: {
      mesos: 120,
      exp: 80,
      items: ["wpn.bronze_shortsword"],
      classRewards: {
        MAGE: ["wpn.apprentice_wand"],
        ARCHER: ["wpn.shortbow"],
        THIEF: ["wpn.rusty_dagger"],
        PIRATE: ["wpn.driftwood_cutlass"],
      },
    },
  },

  /** Q3: Jump lesson — talk back to Iris after climbing a ladder. */
  "quest.dawn_step_jump": {
    id: "quest.dawn_step_jump",
    name: "Leap of Faith",
    giverNpcId: "npc.dawn_guide",
    prereqQuestId: "quest.dawn_trio",
    objectives: [{ kind: "talk", npcId: "npc.dawn_guide" }],
    rewards: { mesos: 50, exp: 40 },
  },

  /** Q4: Loot lesson — talk back to Iris after receiving your starter weapon.
   *  Changed from a collect objective to a talk objective so the quest can't
   *  soft-lock when the player equips or sells the reward sword. */
  "quest.dawn_step_loot": {
    id: "quest.dawn_step_loot",
    name: "Loot the Spoils",
    giverNpcId: "npc.dawn_guide",
    prereqQuestId: "quest.dawn_step_jump",
    objectives: [{ kind: "talk", npcId: "npc.dawn_guide" }],
    rewards: { mesos: 100, exp: 50 },
  },

  /** Q5: Inventory lesson — talk to Iris to learn about your bag. */
  "quest.dawn_step_inventory": {
    id: "quest.dawn_step_inventory",
    name: "Check Your Pockets",
    giverNpcId: "npc.dawn_guide",
    prereqQuestId: "quest.dawn_step_loot",
    objectives: [{ kind: "talk", npcId: "npc.dawn_guide" }],
    rewards: { mesos: 120, exp: 60, items: ["hat.leather_cap"] },
  },

  /** Q6: Reach level 3 — encourages grinding. */
  "quest.dawn_level3": {
    id: "quest.dawn_level3",
    name: "Growing Stronger",
    giverNpcId: "npc.dawn_guide",
    prereqQuestId: "quest.dawn_step_inventory",
    objectives: [{ kind: "level", level: 3 }],
    rewards: { mesos: 200, exp: 100, items: ["hat.leather_cap"] },
  },

  /** Q7: Hunt dawn shrooms (Lv 5). */
  "quest.dawn_shroom_hunt": {
    id: "quest.dawn_shroom_hunt",
    name: "Shroom Shakedown",
    giverNpcId: "npc.dawn_guide",
    requiredLevel: 5,
    prereqQuestId: "quest.dawn_level3",
    objectives: [{ kind: "kill", mobId: "mob.dawn_shroom", count: 8 }],
    rewards: { mesos: 250, exp: 150 },
  },

  /** Q8: Puff patrol + collect snail shells (Lv 6). */
  "quest.dawn_puff_patrol": {
    id: "quest.dawn_puff_patrol",
    name: "Puff Patrol",
    giverNpcId: "npc.dawn_guide",
    requiredLevel: 6,
    prereqQuestId: "quest.dawn_shroom_hunt",
    objectives: [
      { kind: "kill", mobId: "mob.green_puff", count: 10 },
      { kind: "collect", itemId: "etc.snail_shell", count: 5 },
    ],
    rewards: { mesos: 300, exp: 200, items: ["hat.tattered_hood"] },
  },

  /** Q9: Reach level 8 — ready to leave Dawn Isle. */
  "quest.dawn_ready": {
    id: "quest.dawn_ready",
    name: "Ready to Depart",
    giverNpcId: "npc.dawn_guide",
    requiredLevel: 8,
    prereqQuestId: "quest.dawn_puff_patrol",
    objectives: [{ kind: "level", level: 8 }],
    rewards: { mesos: 400, exp: 300, items: ["mount.red_snail"] },
  },

  /** Q10: Talk to Ferrymaster Cole — leave Dawn Isle. */
  "quest.dawn_ferry": {
    id: "quest.dawn_ferry",
    name: "Onward to the Heartland",
    giverNpcId: "npc.dawn_guide",
    requiredLevel: 8,
    prereqQuestId: "quest.dawn_ready",
    objectives: [{ kind: "talk", npcId: "npc.dawn_ferry" }],
    rewards: { mesos: 300, exp: 200 },
  },

  // ── Tidewatch Harbor quests (Lv 3–10) ──────────────────────────────────

  /** Q1: Talk to Harbormaster Lyra — introduction to the harbor. */
  "quest.harbor_welcome": {
    id: "quest.harbor_welcome",
    name: "Welcome to the Harbor",
    giverNpcId: "npc.harbor_guide",
    objectives: [{ kind: "talk", npcId: "npc.harbor_guide" }],
    rewards: { mesos: 50, exp: 40 },
  },

  /** Q2: Clear the dock rats. */
  "quest.harbor_rat_roundup": {
    id: "quest.harbor_rat_roundup",
    name: "Dock Rat Roundup",
    giverNpcId: "npc.harbor_guide",
    requiredLevel: 1,
    prereqQuestId: "quest.harbor_welcome",
    objectives: [{ kind: "kill", mobId: "mob.dock_rat", count: 8 }],
    rewards: { mesos: 200, exp: 120, items: ["hat.leather_cap"] },
  },

  /** Q3: Collect lost cargo from the docks. */
  "quest.harbor_lost_cargo": {
    id: "quest.harbor_lost_cargo",
    name: "Lost Luggage",
    giverNpcId: "npc.harbor_guide",
    requiredLevel: 3,
    prereqQuestId: "quest.harbor_rat_roundup",
    objectives: [{ kind: "collect", itemId: "shoes.worn_boots", count: 3 }],
    rewards: { mesos: 150, exp: 160, items: ["cape.worn_shawl"] },
  },

  /** Q4: Collect rat whiskers for the harbor apothecary. */
  "quest.harbor_rat_whiskers": {
    id: "quest.harbor_rat_whiskers",
    name: "Whisker Collection",
    giverNpcId: "npc.harbor_guide",
    requiredLevel: 5,
    prereqQuestId: "quest.harbor_lost_cargo",
    objectives: [{ kind: "collect", itemId: "etc.rat_whisker", count: 10 }],
    rewards: { mesos: 250, exp: 200 },
  },

  /** Q5: Find the captain's lost cargo manifest. */
  "quest.harbor_captains_log": {
    id: "quest.harbor_captains_log",
    name: "The Captain's Log",
    giverNpcId: "npc.harbor_quest_sailor",
    requiredLevel: 7,
    prereqQuestId: "quest.harbor_rat_whiskers",
    objectives: [{ kind: "collect", itemId: "etc.cargo_manifest", count: 3 }],
    rewards: { mesos: 400, exp: 250, items: ["cape.worn_shawl"] },
  },

  /** Q6: Prove you're ready for the Heartland. */
  "quest.harbor_ready": {
    id: "quest.harbor_ready",
    name: "Ready to Venture",
    giverNpcId: "npc.harbor_guide",
    prereqQuestId: "quest.harbor_captains_log",
    objectives: [{ kind: "level", level: 10 }],
    rewards: { mesos: 300, exp: 300, items: ["gloves.leather_bracers"] },
  },

  // ── Meadowfield quests (Lv 8–14) ──────────────────────────────────────

  /** Q1: Green goo — first meadow task. */
  "quest.meadow_green_goo": {
    id: "quest.meadow_green_goo",
    name: "Green Goo",
    giverNpcId: "npc.meadow_guide",
    requiredLevel: 8,
    objectives: [{ kind: "kill", mobId: "mob.meadow_slime", count: 8 }],
    rewards: { mesos: 300, exp: 200 },
  },

  /** Q2: Slime Roundup — bigger slime hunt. */
  "quest.meadow_slimes": {
    id: "quest.meadow_slimes",
    name: "Slime Roundup",
    giverNpcId: "npc.meadow_guide",
    requiredLevel: 10,
    prereqQuestId: "quest.meadow_green_goo",
    objectives: [{ kind: "kill", mobId: "mob.meadow_slime", count: 10 }],
    rewards: { mesos: 400, exp: 300, items: ["top.traveler_jerkin"] },
  },

  /** Q3: Mushroom madness — kill + collect caps. */
  "quest.meadow_mushroom_madness": {
    id: "quest.meadow_mushroom_madness",
    name: "Mushroom Madness",
    giverNpcId: "npc.meadow_guide",
    requiredLevel: 10,
    prereqQuestId: "quest.meadow_slimes",
    objectives: [
      { kind: "kill", mobId: "mob.mushroom", count: 10 },
      { kind: "collect", itemId: "etc.mushroom_cap", count: 5 },
    ],
    rewards: { mesos: 500, exp: 350, items: ["bottom.leather_greaves"] },
  },

  /** Q4: Hop to it — thornback hopper hunt. */
  "quest.meadow_hopper_hunt": {
    id: "quest.meadow_hopper_hunt",
    name: "Hop to It",
    giverNpcId: "npc.meadow_guide",
    requiredLevel: 12,
    prereqQuestId: "quest.meadow_mushroom_madness",
    objectives: [
      { kind: "kill", mobId: "mob.thornback_hopper", count: 12 },
      { kind: "collect", itemId: "etc.hopper_thorn", count: 5 },
    ],
    rewards: { mesos: 600, exp: 400, items: ["shoes.worn_boots"] },
  },

  /** Q5: Crow control — the meadow is overrun. */
  "quest.meadow_crow_control": {
    id: "quest.meadow_crow_control",
    name: "Crow Control",
    giverNpcId: "npc.meadow_guide",
    requiredLevel: 14,
    prereqQuestId: "quest.meadow_hopper_hunt",
    objectives: [{ kind: "kill", mobId: "mob.crow", count: 10 }],
    rewards: { mesos: 700, exp: 500, items: ["cape.travelers_mantle"] },
  },

  // ── Sylvanreach quests (Lv 10–20) ─────────────────────────────────────

  /** Q1: Talk to Fairy Eluna — introduction to the forest. */
  "quest.sylvan_welcome": {
    id: "quest.sylvan_welcome",
    name: "Whispers of the Canopy",
    giverNpcId: "npc.sylvan_guide",
    requiredLevel: 10,
    objectives: [{ kind: "talk", npcId: "npc.sylvan_guide" }],
    rewards: { mesos: 100, exp: 60 },
  },

  /** Q2: Clear wisps from the mid canopy. */
  "quest.sylvan_forest_clearing": {
    id: "quest.sylvan_forest_clearing",
    name: "Forest Clearing",
    giverNpcId: "npc.sylvan_guide",
    requiredLevel: 10,
    prereqQuestId: "quest.sylvan_welcome",
    objectives: [{ kind: "kill", mobId: "mob.forest_wisp", count: 10 }],
    rewards: { mesos: 400, exp: 300, items: ["hat.woven_circlet"] },
  },

  /** Q3: Collect wisp dust for the alchemist. */
  "quest.sylvan_wisp_essence": {
    id: "quest.sylvan_wisp_essence",
    name: "Wisp Essence",
    giverNpcId: "npc.sylvan_guide",
    requiredLevel: 10,
    prereqQuestId: "quest.sylvan_forest_clearing",
    objectives: [{ kind: "collect", itemId: "etc.wisp_dust", count: 8 }],
    rewards: { mesos: 500, exp: 350 },
  },

  /** Q4: Deal with the canopy pests. */
  "quest.sylvan_canopy_pests": {
    id: "quest.sylvan_canopy_pests",
    name: "Canopy Pests",
    giverNpcId: "npc.sylvan_guide",
    requiredLevel: 12,
    prereqQuestId: "quest.sylvan_wisp_essence",
    objectives: [
      { kind: "kill", mobId: "mob.canopy_moth", count: 8 },
      { kind: "kill", mobId: "mob.bark_spider", count: 5 },
    ],
    rewards: { mesos: 600, exp: 500, items: ["wpn.oakwood_staff"] },
  },

  /** Q5: Collect spider silk for rope-making. */
  "quest.sylvan_spider_silk": {
    id: "quest.sylvan_spider_silk",
    name: "Silk for the Weavers",
    giverNpcId: "npc.sylvan_guide",
    requiredLevel: 14,
    prereqQuestId: "quest.sylvan_canopy_pests",
    objectives: [{ kind: "collect", itemId: "etc.spider_silk", count: 10 }],
    rewards: { mesos: 600, exp: 450 },
  },

  /** Q6: Patrol the roots. */
  "quest.sylvan_root_patrol": {
    id: "quest.sylvan_root_patrol",
    name: "Root Patrol",
    giverNpcId: "npc.sylvan_guide",
    requiredLevel: 15,
    prereqQuestId: "quest.sylvan_spider_silk",
    objectives: [
      { kind: "kill", mobId: "mob.root_crawler", count: 10 },
      { kind: "kill", mobId: "mob.sylvan_sprite", count: 5 },
    ],
    rewards: { mesos: 800, exp: 800, items: ["wpn.frostwick"] },
  },

  /** Q7: Sprite dance — collect moth wings from the canopy. */
  "quest.sylvan_sprite_dance": {
    id: "quest.sylvan_sprite_dance",
    name: "Sprite Dance",
    giverNpcId: "npc.sylvan_guide",
    requiredLevel: 17,
    prereqQuestId: "quest.sylvan_root_patrol",
    objectives: [
      { kind: "kill", mobId: "mob.sylvan_sprite", count: 8 },
      { kind: "collect", itemId: "etc.moth_wing", count: 8 },
    ],
    rewards: { mesos: 900, exp: 900, items: ["hat.woven_circlet"] },
  },

  /** Q8: Prove mastery of the forest. */
  "quest.sylvan_heart": {
    id: "quest.sylvan_heart",
    name: "Heart of the Forest",
    giverNpcId: "npc.sylvan_guide",
    prereqQuestId: "quest.sylvan_sprite_dance",
    objectives: [{ kind: "level", level: 20 }],
    rewards: { mesos: 1000, exp: 1000, items: ["hat.sage_circlet"] },
  },

  // ── Craghold quests (Lv 10–20) ────────────────────────────────────────

  /** Q1: Talk to Forge Master Korrin — introduction to the plateau. */
  "quest.crag_welcome": {
    id: "quest.crag_welcome",
    name: "The Stone Challenge",
    giverNpcId: "npc.crag_guide",
    requiredLevel: 10,
    objectives: [{ kind: "talk", npcId: "npc.crag_guide" }],
    rewards: { mesos: 100, exp: 60 },
  },

  /** Q2: Thin out the lizards and beetles. */
  "quest.crag_lizard_roundup": {
    id: "quest.crag_lizard_roundup",
    name: "Lizard Roundup",
    giverNpcId: "npc.crag_guide",
    requiredLevel: 10,
    prereqQuestId: "quest.crag_welcome",
    objectives: [
      { kind: "kill", mobId: "mob.rock_lizard", count: 10 },
      { kind: "kill", mobId: "mob.fossil_beetle", count: 5 },
    ],
    rewards: { mesos: 400, exp: 300, items: ["wpn.iron_broadsword"] },
  },

  /** Q3: Collect lizard scales for the forge. */
  "quest.crag_scale_quest": {
    id: "quest.crag_scale_quest",
    name: "Scaled for Battle",
    giverNpcId: "npc.crag_guide",
    requiredLevel: 11,
    prereqQuestId: "quest.crag_lizard_roundup",
    objectives: [{ kind: "collect", itemId: "etc.lizard_scale", count: 8 }],
    rewards: { mesos: 500, exp: 350 },
  },

  /** Q4: Beetle bounty — hunt fossil beetles. */
  "quest.crag_beetle_bounty": {
    id: "quest.crag_beetle_bounty",
    name: "Beetle Bounty",
    giverNpcId: "npc.crag_guide",
    requiredLevel: 13,
    prereqQuestId: "quest.crag_scale_quest",
    objectives: [
      { kind: "kill", mobId: "mob.fossil_beetle", count: 10 },
      { kind: "collect", itemId: "etc.beetle_shell", count: 5 },
    ],
    rewards: { mesos: 600, exp: 450 },
  },

  /** Q5: Deal with the cliff hawks. */
  "quest.crag_hawk_watch": {
    id: "quest.crag_hawk_watch",
    name: "Hawk Watch",
    giverNpcId: "npc.crag_guide",
    requiredLevel: 14,
    prereqQuestId: "quest.crag_beetle_bounty",
    objectives: [{ kind: "kill", mobId: "mob.cliff_hawk", count: 8 }],
    rewards: { mesos: 600, exp: 500, items: ["hat.iron_crest_helm"] },
  },

  /** Q6: Brave the quarry depths. */
  "quest.crag_quarry_depths": {
    id: "quest.crag_quarry_depths",
    name: "Quarry Depths",
    giverNpcId: "npc.crag_guide",
    requiredLevel: 16,
    prereqQuestId: "quest.crag_hawk_watch",
    objectives: [
      { kind: "kill", mobId: "mob.quarry_crab", count: 6 },
      { kind: "kill", mobId: "mob.boulder_golem", count: 4 },
    ],
    rewards: { mesos: 800, exp: 800, items: ["shield.iron_buckler"] },
  },

  /** Q7: Crab catch — collect hawk feathers and crab claws. */
  "quest.crag_crab_catch": {
    id: "quest.crag_crab_catch",
    name: "Cliffs and Claws",
    giverNpcId: "npc.crag_guide",
    requiredLevel: 17,
    prereqQuestId: "quest.crag_quarry_depths",
    objectives: [
      { kind: "collect", itemId: "etc.hawk_feather", count: 6 },
      { kind: "kill", mobId: "mob.quarry_crab", count: 8 },
    ],
    rewards: { mesos: 900, exp: 850, items: ["cape.travelers_mantle"] },
  },

  /** Q8: Prove your iron will. */
  "quest.crag_iron_will": {
    id: "quest.crag_iron_will",
    name: "Forged in Stone",
    giverNpcId: "npc.crag_guide",
    prereqQuestId: "quest.crag_crab_catch",
    objectives: [{ kind: "level", level: 20 }],
    rewards: { mesos: 1000, exp: 1000, items: ["hat.steel_vanguard"] },
  },

  // ── Dusk Ward quests (Lv 10–20) ───────────────────────────────────────

  /** Q1: Talk to Fixer Nyx — introduction to the undercity. */
  "quest.dusk_welcome": {
    id: "quest.dusk_welcome",
    name: "Neon Nights",
    giverNpcId: "npc.dusk_guide",
    requiredLevel: 10,
    objectives: [{ kind: "talk", npcId: "npc.dusk_guide" }],
    rewards: { mesos: 100, exp: 60 },
  },

  /** Q2: Clear the subway of vermin. */
  "quest.dusk_subway_sweep": {
    id: "quest.dusk_subway_sweep",
    name: "Subway Sweep",
    giverNpcId: "npc.dusk_guide",
    requiredLevel: 10,
    prereqQuestId: "quest.dusk_welcome",
    objectives: [
      { kind: "kill", mobId: "mob.neon_rat", count: 12 },
      { kind: "kill", mobId: "mob.tunnel_bat", count: 5 },
    ],
    rewards: { mesos: 400, exp: 300, items: ["wpn.nightfang_dagger"] },
  },

  /** Q3: Tag collection — collect neon tags from rats. */
  "quest.dusk_tag_collection": {
    id: "quest.dusk_tag_collection",
    name: "Tag Collection",
    giverNpcId: "npc.dusk_guide",
    requiredLevel: 11,
    prereqQuestId: "quest.dusk_subway_sweep",
    objectives: [{ kind: "collect", itemId: "etc.neon_tag", count: 8 }],
    rewards: { mesos: 500, exp: 350 },
  },

  /** Q4: Patrol the rail platforms. */
  "quest.dusk_rail_patrol": {
    id: "quest.dusk_rail_patrol",
    name: "Patrol the Rails",
    giverNpcId: "npc.dusk_guide",
    requiredLevel: 13,
    prereqQuestId: "quest.dusk_tag_collection",
    objectives: [
      { kind: "kill", mobId: "mob.spark_drone", count: 8 },
      { kind: "kill", mobId: "mob.rail_sentinel", count: 5 },
    ],
    rewards: { mesos: 600, exp: 500, items: ["hat.rogue_cowl"] },
  },

  /** Q5: Drone hunt — more rail platform clearing. */
  "quest.dusk_drone_hunt": {
    id: "quest.dusk_drone_hunt",
    name: "Drone Hunt",
    giverNpcId: "npc.dusk_guide",
    requiredLevel: 15,
    prereqQuestId: "quest.dusk_rail_patrol",
    objectives: [
      { kind: "kill", mobId: "mob.spark_drone", count: 10 },
      { kind: "kill", mobId: "mob.tunnel_bat", count: 8 },
    ],
    rewards: { mesos: 700, exp: 600, items: ["cape.travelers_mantle"] },
  },

  /** Q6: Clean up the backalleys. */
  "quest.dusk_backalley_cleanup": {
    id: "quest.dusk_backalley_cleanup",
    name: "Backalley Cleanup",
    giverNpcId: "npc.dusk_guide",
    requiredLevel: 16,
    prereqQuestId: "quest.dusk_drone_hunt",
    objectives: [
      { kind: "kill", mobId: "mob.shadow_thug", count: 10 },
      { kind: "kill", mobId: "mob.neon_spider", count: 8 },
    ],
    rewards: { mesos: 800, exp: 800, items: ["top.rogues_wrap"] },
  },

  /** Q7: Prove your shadow mastery. */
  "quest.dusk_shadow_end": {
    id: "quest.dusk_shadow_end",
    name: "Shadow's End",
    giverNpcId: "npc.dusk_guide",
    prereqQuestId: "quest.dusk_backalley_cleanup",
    objectives: [{ kind: "level", level: 20 }],
    rewards: { mesos: 1000, exp: 1000, items: ["shoes.windwalker_slippers"] },
  },

  // ── Crossway quests (Lv 15–25) ────────────────────────────────────────

  /** Q1: Talk to Keeper Aldric — introduction to the hub. */
  "quest.crossway_welcome": {
    id: "quest.crossway_welcome",
    name: "Crossroads Calling",
    giverNpcId: "npc.crossway_guide",
    requiredLevel: 15,
    objectives: [{ kind: "talk", npcId: "npc.crossway_guide" }],
    rewards: { mesos: 100, exp: 60 },
  },

  /** Q2: Visit guides across the Heartland. */
  "quest.crossway_messenger": {
    id: "quest.crossway_messenger",
    name: "Heartland Messenger",
    giverNpcId: "npc.crossway_guide",
    requiredLevel: 15,
    prereqQuestId: "quest.crossway_welcome",
    objectives: [
      { kind: "talk", npcId: "npc.harbor_guide" },
      { kind: "talk", npcId: "npc.sylvan_guide" },
      { kind: "talk", npcId: "npc.crag_guide" },
    ],
    rewards: { mesos: 500, exp: 400, items: ["cape.travelers_mantle"] },
  },

  /** Q3: Defend the crossroads from roaming threats. */
  "quest.crossway_defender": {
    id: "quest.crossway_defender",
    name: "Defender of the Crossroads",
    giverNpcId: "npc.crossway_guide",
    requiredLevel: 18,
    prereqQuestId: "quest.crossway_messenger",
    objectives: [
      { kind: "kill", mobId: "mob.cliff_hawk", count: 10 },
      { kind: "kill", mobId: "mob.rail_sentinel", count: 8 },
      { kind: "kill", mobId: "mob.bark_spider", count: 6 },
    ],
    rewards: { mesos: 800, exp: 800, items: ["shield.reinforced_targe"] },
  },

  /** Q4: Escort — talk to the Mirefen guide. */
  "quest.crossway_escort": {
    id: "quest.crossway_escort",
    name: "Path to the Swamp",
    giverNpcId: "npc.crossway_guide",
    requiredLevel: 20,
    prereqQuestId: "quest.crossway_defender",
    objectives: [{ kind: "talk", npcId: "npc.mirefen_guide" }],
    rewards: { mesos: 600, exp: 500 },
  },

  /** Q5: Collect a relic from the Heartland crossroads. */
  "quest.crossway_relic_hunt": {
    id: "quest.crossway_relic_hunt",
    name: "Heartland Relics",
    giverNpcId: "npc.crossway_guide",
    requiredLevel: 22,
    prereqQuestId: "quest.crossway_escort",
    objectives: [{ kind: "collect", itemId: "etc.ruins_tablet", count: 3 }],
    rewards: { mesos: 700, exp: 600 },
  },

  /** Q6: Prove yourself a champion of the Heartland. */
  "quest.crossway_champion": {
    id: "quest.crossway_champion",
    name: "Heartland Champion",
    giverNpcId: "npc.crossway_guide",
    prereqQuestId: "quest.crossway_relic_hunt",
    objectives: [{ kind: "level", level: 25 }],
    rewards: { mesos: 1200, exp: 1200, items: ["hat.steel_vanguard"] },
  },

  // ── Mirefen quests (Lv 20–30) ────────────────────────────────────────

  /** Q1: Talk to Swamplight Maren — introduction to the swamp. */
  "quest.mirefen_welcome": {
    id: "quest.mirefen_welcome",
    name: "Mirefen's Call",
    giverNpcId: "npc.mirefen_guide",
    requiredLevel: 20,
    objectives: [{ kind: "talk", npcId: "npc.mirefen_guide" }],
    rewards: { mesos: 150, exp: 100 },
  },

  /** Q2: Purge the bog of lurkers and toads. */
  "quest.mirefen_bog_purge": {
    id: "quest.mirefen_bog_purge",
    name: "Bog Purge",
    giverNpcId: "npc.mirefen_guide",
    requiredLevel: 20,
    prereqQuestId: "quest.mirefen_welcome",
    objectives: [
      { kind: "kill", mobId: "mob.bog_lurker", count: 12 },
      { kind: "kill", mobId: "mob.mire_toad", count: 8 },
    ],
    rewards: { mesos: 600, exp: 600, items: ["wpn.steel_fang"] },
  },

  /** Q3: Collect bog samples for the apothecary. */
  "quest.mirefen_bog_sample": {
    id: "quest.mirefen_bog_sample",
    name: "Bog Samples",
    giverNpcId: "npc.mirefen_guide",
    requiredLevel: 22,
    prereqQuestId: "quest.mirefen_bog_purge",
    objectives: [{ kind: "collect", itemId: "etc.bog_sample", count: 5 }],
    rewards: { mesos: 700, exp: 500 },
  },

  /** Q4: Hunt the ruins sentinels. */
  "quest.mirefen_sentinel_relics": {
    id: "quest.mirefen_sentinel_relics",
    name: "Sentinel Relics",
    giverNpcId: "npc.mirefen_guide",
    requiredLevel: 25,
    prereqQuestId: "quest.mirefen_bog_sample",
    objectives: [{ kind: "kill", mobId: "mob.ruins_sentinel", count: 8 }],
    rewards: { mesos: 1000, exp: 1000, items: ["hat.iron_crest_helm"] },
  },

  /** Q5: Collect ruins tablets from sentinels. */
  "quest.mirefen_tablet_quest": {
    id: "quest.mirefen_tablet_quest",
    name: "Tablet Recovery",
    giverNpcId: "npc.mirefen_guide",
    requiredLevel: 26,
    prereqQuestId: "quest.mirefen_sentinel_relics",
    objectives: [{ kind: "collect", itemId: "etc.ruins_tablet", count: 5 }],
    rewards: { mesos: 1200, exp: 1100 },
  },

  /** Q6: Hunt the moss wraiths in the upper ruins. */
  "quest.mirefen_wraith_hunt": {
    id: "quest.mirefen_wraith_hunt",
    name: "Wraith Hunt",
    giverNpcId: "npc.mirefen_guide",
    requiredLevel: 27,
    prereqQuestId: "quest.mirefen_tablet_quest",
    objectives: [{ kind: "kill", mobId: "mob.moss_wraith", count: 10 }],
    rewards: { mesos: 1500, exp: 1400, items: ["wpn.shadow_fang"] },
  },

  /** Q7: Face the dungeon boss. */
  "quest.mirefen_ruin_behemoth": {
    id: "quest.mirefen_ruin_behemoth",
    name: "The Ruin Behemoth",
    giverNpcId: "npc.mirefen_guide",
    requiredLevel: 28,
    prereqQuestId: "quest.mirefen_wraith_hunt",
    objectives: [{ kind: "kill", mobId: "mob.bogmaw", count: 1 }],
    rewards: {
      mesos: 3000,
      exp: 3000,
      items: ["hat.steel_vanguard", "cape.wardens_cloak"],
    },
  },

  // ── Skyhaven quests (Lv 30–40) ───────────────────────────────────────

  /** Q1: Talk to Windkeeper Zara — arrival in Skyhaven. */
  "quest.skyhaven_arrival": {
    id: "quest.skyhaven_arrival",
    name: "Welcome to the Sky",
    giverNpcId: "npc.skyhaven_guide",
    requiredLevel: 30,
    objectives: [{ kind: "talk", npcId: "npc.skyhaven_guide" }],
    rewards: { mesos: 200, exp: 150 },
  },

  /** Q2: Hunt wind sprites in the Driftpeaks. */
  "quest.skyhaven_wind_sprite_hunt": {
    id: "quest.skyhaven_wind_sprite_hunt",
    name: "Wind Sprite Hunt",
    giverNpcId: "npc.skyhaven_quest",
    requiredLevel: 30,
    prereqQuestId: "quest.skyhaven_arrival",
    objectives: [{ kind: "kill", mobId: "mob.wind_sprite", count: 12 }],
    rewards: { mesos: 1200, exp: 1000, items: ["wpn.crimson_edge"] },
  },

  /** Q3: Gather sky crystals from the upper rocks. */
  "quest.skyhaven_crystal_gathering": {
    id: "quest.skyhaven_crystal_gathering",
    name: "Crystal Gathering",
    giverNpcId: "npc.skyhaven_quest",
    requiredLevel: 32,
    prereqQuestId: "quest.skyhaven_wind_sprite_hunt",
    objectives: [{ kind: "collect", itemId: "etc.sky_crystal", count: 8 }],
    rewards: { mesos: 1500, exp: 1200, items: ["hat.steel_vanguard"] },
  },

  /** Q4: Hunt sky serpents on the mid-level rocks. */
  "quest.skyhaven_serpent_hunt": {
    id: "quest.skyhaven_serpent_hunt",
    name: "Serpent Hunt",
    giverNpcId: "npc.skyhaven_quest",
    requiredLevel: 35,
    prereqQuestId: "quest.skyhaven_crystal_gathering",
    objectives: [{ kind: "kill", mobId: "mob.sky_serpent", count: 10 }],
    rewards: { mesos: 2000, exp: 1500, items: ["top.plate_cuirass"] },
  },

  /** Q5: Thunder hawk flight — clear the highest peaks. */
  "quest.skyhaven_thunder_hawk_flight": {
    id: "quest.skyhaven_thunder_hawk_flight",
    name: "Thunder Hawk Flight",
    giverNpcId: "npc.skyhaven_quest",
    requiredLevel: 38,
    prereqQuestId: "quest.skyhaven_serpent_hunt",
    objectives: [
      { kind: "kill", mobId: "mob.thunder_hawk", count: 10 },
      { kind: "collect", itemId: "etc.serpent_scale", count: 5 },
    ],
    rewards: { mesos: 2500, exp: 1800, items: ["cape.ironbound_cape"] },
  },

  /** Q6: Reach level 40 — mastery of the skies. */
  "quest.skyhaven_sky_master": {
    id: "quest.skyhaven_sky_master",
    name: "Sky Master",
    giverNpcId: "npc.skyhaven_guide",
    prereqQuestId: "quest.skyhaven_thunder_hawk_flight",
    objectives: [{ kind: "level", level: 40 }],
    rewards: { mesos: 3000, exp: 2500, items: ["hat.dragonbone_crown"] },
  },

  // ── Frosthold quests (Lv 35–55) ──────────────────────────────────────

  /** Q1: Talk to Frost Warden Eira — arrival in Frosthold. */
  "quest.frosthold_arrival": {
    id: "quest.frosthold_arrival",
    name: "The Frozen Edge",
    giverNpcId: "npc.frosthold_guide",
    requiredLevel: 35,
    objectives: [{ kind: "talk", npcId: "npc.frosthold_guide" }],
    rewards: { mesos: 250, exp: 200 },
  },

  /** Q2: Wolf patrol — clear frost wolves from the slopes. */
  "quest.frosthold_wolf_patrol": {
    id: "quest.frosthold_wolf_patrol",
    name: "Wolf Patrol",
    giverNpcId: "npc.frosthold_quest",
    requiredLevel: 35,
    prereqQuestId: "quest.frosthold_arrival",
    objectives: [{ kind: "kill", mobId: "mob.frost_wolf", count: 12 }],
    rewards: { mesos: 1800, exp: 1400, items: ["wpn.solstice_blade"] },
  },

  /** Q3: Collect frost fangs for the expedition. */
  "quest.frosthold_fang_collection": {
    id: "quest.frosthold_fang_collection",
    name: "Fang Collection",
    giverNpcId: "npc.frosthold_quest",
    requiredLevel: 37,
    prereqQuestId: "quest.frosthold_wolf_patrol",
    objectives: [{ kind: "collect", itemId: "etc.frost_fang", count: 10 }],
    rewards: { mesos: 2200, exp: 1600, items: ["top.ironwrought_mantle"] },
  },

  /** Q4: Elemental purge — ice elementals on the slopes. */
  "quest.frosthold_elemental_purge": {
    id: "quest.frosthold_elemental_purge",
    name: "Elemental Purge",
    giverNpcId: "npc.frosthold_quest",
    requiredLevel: 38,
    prereqQuestId: "quest.frosthold_fang_collection",
    objectives: [{ kind: "kill", mobId: "mob.ice_elemental", count: 10 }],
    rewards: { mesos: 2500, exp: 1800, items: ["shield.ironwrought_aegis"] },
  },

  /** Q5: Collect ice shards for the wardens. */
  "quest.frosthold_crystal_hunt": {
    id: "quest.frosthold_crystal_hunt",
    name: "Crystal Hunt",
    giverNpcId: "npc.frosthold_quest",
    requiredLevel: 42,
    prereqQuestId: "quest.frosthold_elemental_purge",
    objectives: [{ kind: "collect", itemId: "etc.ice_shard", count: 8 }],
    rewards: { mesos: 3000, exp: 2200 },
  },

  /** Q6: Talk to Saga — descend into the Icecave. */
  "quest.frosthold_icecave_descent": {
    id: "quest.frosthold_icecave_descent",
    name: "Into the Icecave",
    giverNpcId: "npc.frosthold_quest",
    requiredLevel: 45,
    prereqQuestId: "quest.frosthold_crystal_hunt",
    objectives: [{ kind: "talk", npcId: "npc.frosthold_quest" }],
    rewards: { mesos: 3500, exp: 2500 },
  },

  /** Q7: Hunt permafrost revenants deep in the Icecave. */
  "quest.frosthold_revenant_hunt": {
    id: "quest.frosthold_revenant_hunt",
    name: "Revenant Hunt",
    giverNpcId: "npc.frosthold_quest",
    requiredLevel: 50,
    prereqQuestId: "quest.frosthold_icecave_descent",
    objectives: [{ kind: "kill", mobId: "mob.permafrost_revenant", count: 10 }],
    rewards: { mesos: 4500, exp: 3500, items: ["hat.obsidian_greathelm"] },
  },

  /** Q8: Banshee bane — defeat frost banshees. */
  "quest.frosthold_banshee_bane": {
    id: "quest.frosthold_banshee_bane",
    name: "Banshee Bane",
    giverNpcId: "npc.frosthold_quest",
    requiredLevel: 55,
    prereqQuestId: "quest.frosthold_revenant_hunt",
    objectives: [{ kind: "kill", mobId: "mob.frost_banshee", count: 12 }],
    rewards: { mesos: 5500, exp: 4500, items: ["cape.obsidian_shroud"] },
  },

  /** Q9: Collect frozen hearts — prove mastery of Frosthold. */
  "quest.frosthold_frozen_heart": {
    id: "quest.frosthold_frozen_heart",
    name: "Frozen Heart",
    giverNpcId: "npc.frosthold_quest",
    requiredLevel: 55,
    prereqQuestId: "quest.frosthold_banshee_bane",
    objectives: [{ kind: "collect", itemId: "etc.frozen_heart", count: 5 }],
    rewards: { mesos: 6000, exp: 5000, items: ["hat.aethercrest_helm"] },
  },

  // ── Tideways quests (Lv 35–55) ───────────────────────────────────────

  /** Q1: Talk to Tidal Sage Nerissa — arrival in Tideways. */
  "quest.tideways_arrival": {
    id: "quest.tideways_arrival",
    name: "The Deep Blue",
    giverNpcId: "npc.tideways_guide",
    requiredLevel: 35,
    objectives: [{ kind: "talk", npcId: "npc.tideways_guide" }],
    rewards: { mesos: 300, exp: 250 },
  },

  /** Q2: Reef jellyfish patrol — clear the coral gardens. */
  "quest.tideways_jelly_patrol": {
    id: "quest.tideways_jelly_patrol",
    name: "Jellyfish Jig",
    giverNpcId: "npc.tideways_quest",
    requiredLevel: 35,
    prereqQuestId: "quest.tideways_arrival",
    objectives: [{ kind: "kill", mobId: "mob.reef_jellyfish", count: 12 }],
    rewards: { mesos: 2000, exp: 1600, items: ["wpn.voidcleaver"] },
  },

  /** Q3: Collect jelly tentacles for the apothecary. */
  "quest.tideways_tentacle_quest": {
    id: "quest.tideways_tentacle_quest",
    name: "Tentacle Harvest",
    giverNpcId: "npc.tideways_quest",
    requiredLevel: 37,
    prereqQuestId: "quest.tideways_jelly_patrol",
    objectives: [{ kind: "collect", itemId: "etc.jelly_tentacle", count: 10 }],
    rewards: { mesos: 2500, exp: 1800, items: ["hat.obsidian_greathelm"] },
  },

  /** Q4: Urchin hunt — clear the sea urchins from the coral platform. */
  "quest.tideways_urchin_hunt": {
    id: "quest.tideways_urchin_hunt",
    name: "Urchin Uproar",
    giverNpcId: "npc.tideways_quest",
    requiredLevel: 38,
    prereqQuestId: "quest.tideways_tentacle_quest",
    objectives: [{ kind: "kill", mobId: "mob.sea_urchin", count: 10 }],
    rewards: { mesos: 2800, exp: 2000, items: ["shield.obsidian_citadel"] },
  },

  /** Q5: Pufferfish roundup + collect spines. */
  "quest.tideways_puffer_roundup": {
    id: "quest.tideways_puffer_roundup",
    name: "Puffer Panic",
    giverNpcId: "npc.tideways_quest",
    requiredLevel: 40,
    prereqQuestId: "quest.tideways_urchin_hunt",
    objectives: [
      { kind: "kill", mobId: "mob.pufferfish", count: 10 },
      { kind: "collect", itemId: "etc.puffer_spine", count: 5 },
    ],
    rewards: { mesos: 3200, exp: 2400, items: ["cape.obsidian_shroud"] },
  },

  /** Q6: Anglerfish depths — descend into the abyss. */
  "quest.tideways_anglerfish_depths": {
    id: "quest.tideways_anglerfish_depths",
    name: "Anglerfish Abyss",
    giverNpcId: "npc.tideways_quest",
    requiredLevel: 45,
    prereqQuestId: "quest.tideways_puffer_roundup",
    objectives: [{ kind: "kill", mobId: "mob.anglerfish", count: 12 }],
    rewards: { mesos: 4000, exp: 3000, items: ["wpn.titans_grudge"] },
  },

  /** Q7: Tiger shark hunt — brave the deep waters. */
  "quest.tideways_shark_hunt": {
    id: "quest.tideways_shark_hunt",
    name: "Shark Hunt",
    giverNpcId: "npc.tideways_quest",
    requiredLevel: 50,
    prereqQuestId: "quest.tideways_anglerfish_depths",
    objectives: [{ kind: "kill", mobId: "mob.tiger_shark", count: 10 }],
    rewards: { mesos: 5000, exp: 4000, items: ["hat.arcane_diadem"] },
  },

  /** Q8: Sea serpent patrol — the abyss is overrun. */
  "quest.tideways_serpent_patrol": {
    id: "quest.tideways_serpent_patrol",
    name: "Serpent Patrol",
    giverNpcId: "npc.tideways_quest",
    requiredLevel: 55,
    prereqQuestId: "quest.tideways_shark_hunt",
    objectives: [{ kind: "kill", mobId: "mob.sea_serpent", count: 10 }],
    rewards: { mesos: 6000, exp: 5000, items: ["top.dragonscale_aegis"] },
  },

  /** Q9: Face the Kraken — defeat the Abyssal Terror. */
  "quest.tideways_kraken": {
    id: "quest.tideways_kraken",
    name: "The Abyssal Terror",
    giverNpcId: "npc.tideways_quest",
    requiredLevel: 55,
    prereqQuestId: "quest.tideways_serpent_patrol",
    objectives: [{ kind: "kill", mobId: "mob.kraken", count: 1 }],
    rewards: {
      mesos: 10000,
      exp: 8000,
      items: ["hat.obsidian_greathelm", "cape.obsidian_shroud"],
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Job Advancement Quest Chains
  //
  // Each archetype has four advancement quests (tiers 1-4) given by the class
  // instructor NPC in the archetype's hometown. The server reads the
  // `jobAdvanceToTier` reward field to promote the player upon quest turn-in.
  //
  // Hometowns:
  //   Warrior  → craghold
  //   Mage     → sylvanreach
  //   Archer   → meadowfield
  //   Thief    → dusk_ward
  //   Pirate   → heartland_harbor
  // ──────────────────────────────────────────────────────────────────────────

  // ── Warrior — craghold ──────────────────────────────────────────────────

  /** Warrior 1st job — prove yourself to the Craghold instructor. */
  "quest.warrior_job_1": {
    id: "quest.warrior_job_1",
    name: "The Warrior's Oath",
    giverNpcId: "npc.craghold_instructor_warrior",
    requiredLevel: 10,
    objectives: [{ kind: "talk", npcId: "npc.craghold_instructor_warrior" }],
    rewards: {
      mesos: 500,
      exp: 200,
      items: ["wpn.oak_maul"],
      jobAdvanceToTier: 1,
    },
  },

  /** Warrior 2nd job — hunt lizards in the cliffs to prove your mettle. */
  "quest.warrior_job_2": {
    id: "quest.warrior_job_2",
    name: "Trial of the Cliffs",
    giverNpcId: "npc.craghold_instructor_warrior",
    requiredLevel: 30,
    objectives: [
      { kind: "kill", mobId: "mob.rock_lizard", count: 20 },
      { kind: "kill", mobId: "mob.cliff_hawk", count: 10 },
    ],
    rewards: {
      mesos: 5000,
      exp: 3000,
      items: ["wpn.crimson_edge"],
      jobAdvanceToTier: 2,
    },
  },

  /** Warrior 3rd job — brave the quarry and collect proof. */
  "quest.warrior_job_3": {
    id: "quest.warrior_job_3",
    name: "Forged in Stone",
    giverNpcId: "npc.craghold_instructor_warrior",
    requiredLevel: 60,
    objectives: [
      { kind: "kill", mobId: "mob.boulder_golem", count: 30 },
      { kind: "collect", itemId: "shield.iron_buckler", count: 5 },
    ],
    rewards: {
      mesos: 15000,
      exp: 12000,
      items: ["wpn.aetherfang"],
      jobAdvanceToTier: 3,
    },
  },

  /** Warrior 4th job — defeat the Bogmaw to prove mastery. */
  "quest.warrior_job_4": {
    id: "quest.warrior_job_4",
    name: "The Doombringer's Vow",
    giverNpcId: "npc.craghold_instructor_warrior",
    requiredLevel: 100,
    objectives: [
      { kind: "kill", mobId: "mob.bogmaw", count: 1 },
      { kind: "collect", itemId: "shield.reinforced_targe", count: 3 },
    ],
    rewards: {
      mesos: 50000,
      exp: 40000,
      items: ["hat.aethercrest_helm"],
      jobAdvanceToTier: 4,
    },
  },

  // ── Mage — sylvanreach ──────────────────────────────────────────────────

  /** Mage 1st job — the Sylvanreach instructor initiates you. */
  "quest.mage_job_1": {
    id: "quest.mage_job_1",
    name: "Arcane Awakening",
    giverNpcId: "npc.sylvanreach_instructor_mage",
    requiredLevel: 10,
    objectives: [{ kind: "talk", npcId: "npc.sylvanreach_instructor_mage" }],
    rewards: {
      mesos: 500,
      exp: 200,
      items: ["wpn.oakwood_staff"],
      jobAdvanceToTier: 1,
    },
  },

  /** Mage 2nd job — collect arcane catalysts from forest creatures. */
  "quest.mage_job_2": {
    id: "quest.mage_job_2",
    name: "Catalyst of Power",
    giverNpcId: "npc.sylvanreach_instructor_mage",
    requiredLevel: 30,
    objectives: [
      { kind: "kill", mobId: "mob.sylvan_sprite", count: 20 },
      { kind: "collect", itemId: "hat.woven_circlet", count: 5 },
    ],
    rewards: {
      mesos: 5000,
      exp: 3000,
      items: ["wpn.stormbloom"],
      jobAdvanceToTier: 2,
    },
  },

  /** Mage 3rd job — master the canopy. */
  "quest.mage_job_3": {
    id: "quest.mage_job_3",
    name: "Canopy Sovereign",
    giverNpcId: "npc.sylvanreach_instructor_mage",
    requiredLevel: 60,
    objectives: [
      { kind: "kill", mobId: "mob.canopy_moth", count: 30 },
      { kind: "kill", mobId: "mob.bark_spider", count: 20 },
    ],
    rewards: {
      mesos: 15000,
      exp: 12000,
      items: ["wpn.astral_conductor"],
      jobAdvanceToTier: 3,
    },
  },

  /** Mage 4th job — prove mastery over the roots. */
  "quest.mage_job_4": {
    id: "quest.mage_job_4",
    name: "Apocalypse Unbound",
    giverNpcId: "npc.sylvanreach_instructor_mage",
    requiredLevel: 100,
    objectives: [
      { kind: "kill", mobId: "mob.root_crawler", count: 25 },
      { kind: "collect", itemId: "hat.sage_circlet", count: 3 },
    ],
    rewards: {
      mesos: 50000,
      exp: 40000,
      items: ["hat.arcane_diadem"],
      jobAdvanceToTier: 4,
    },
  },

  // ── Archer — meadowfield ────────────────────────────────────────────────

  /** Archer 1st job — Meadowfield instructor marks you as a Scout. */
  "quest.archer_job_1": {
    id: "quest.archer_job_1",
    name: "Marksman's Creed",
    giverNpcId: "npc.meadowfield_instructor_archer",
    requiredLevel: 10,
    objectives: [{ kind: "talk", npcId: "npc.meadowfield_instructor_archer" }],
    rewards: {
      mesos: 500,
      exp: 200,
      items: ["wpn.gale_bow"],
      jobAdvanceToTier: 1,
    },
  },

  /** Archer 2nd job — cull the meadow pests. */
  "quest.archer_job_2": {
    id: "quest.archer_job_2",
    name: "The Long Range Trial",
    giverNpcId: "npc.meadowfield_instructor_archer",
    requiredLevel: 30,
    objectives: [
      { kind: "kill", mobId: "mob.thornback_hopper", count: 20 },
      { kind: "kill", mobId: "mob.mushroom", count: 15 },
    ],
    rewards: {
      mesos: 5000,
      exp: 3000,
      items: ["wpn.windpiercer"],
      jobAdvanceToTier: 2,
    },
  },

  /** Archer 3rd job — prove precision against crows. */
  "quest.archer_job_3": {
    id: "quest.archer_job_3",
    name: "Eagle's Gaze",
    giverNpcId: "npc.meadowfield_instructor_archer",
    requiredLevel: 60,
    objectives: [
      { kind: "kill", mobId: "mob.crow", count: 25 },
      { kind: "collect", itemId: "cape.travelers_mantle", count: 5 },
    ],
    rewards: {
      mesos: 15000,
      exp: 12000,
      items: ["wpn.stormcaller"],
      jobAdvanceToTier: 3,
    },
  },

  /** Archer 4th job — defeat the sky serpents. */
  "quest.archer_job_4": {
    id: "quest.archer_job_4",
    name: "Galestriker Ascendant",
    giverNpcId: "npc.meadowfield_instructor_archer",
    requiredLevel: 100,
    objectives: [
      { kind: "kill", mobId: "mob.sky_serpent", count: 20 },
      { kind: "kill", mobId: "mob.thunder_hawk", count: 15 },
    ],
    rewards: {
      mesos: 50000,
      exp: 40000,
      items: ["wpn.stormcaller"],
      jobAdvanceToTier: 4,
    },
  },

  // ── Thief — dusk_ward ───────────────────────────────────────────────────

  /** Thief 1st job — the Dusk-Ward shadow master initiates you. */
  "quest.thief_job_1": {
    id: "quest.thief_job_1",
    name: "Shadow Induction",
    giverNpcId: "npc.dusk_ward_instructor_thief",
    requiredLevel: 10,
    objectives: [{ kind: "talk", npcId: "npc.dusk_ward_instructor_thief" }],
    rewards: {
      mesos: 500,
      exp: 200,
      items: ["wpn.nightfang_dagger"],
      jobAdvanceToTier: 1,
    },
  },

  /** Thief 2nd job — clear the subway of neon vermin. */
  "quest.thief_job_2": {
    id: "quest.thief_job_2",
    name: "Night Prowl",
    giverNpcId: "npc.dusk_ward_instructor_thief",
    requiredLevel: 30,
    objectives: [
      { kind: "kill", mobId: "mob.neon_rat", count: 20 },
      { kind: "kill", mobId: "mob.tunnel_bat", count: 15 },
    ],
    rewards: {
      mesos: 5000,
      exp: 3000,
      items: ["wpn.widows_kiss"],
      jobAdvanceToTier: 2,
    },
  },

  /** Thief 3rd job — dismantle the backalley syndicate. */
  "quest.thief_job_3": {
    id: "quest.thief_job_3",
    name: "Blade in the Dark",
    giverNpcId: "npc.dusk_ward_instructor_thief",
    requiredLevel: 60,
    objectives: [
      { kind: "kill", mobId: "mob.shadow_thug", count: 25 },
      { kind: "collect", itemId: "cape.wardens_cloak", count: 3 },
    ],
    rewards: {
      mesos: 15000,
      exp: 12000,
      items: ["wpn.oblivion_shard"],
      jobAdvanceToTier: 3,
    },
  },

  /** Thief 4th job — neutralize the arc wraiths. */
  "quest.thief_job_4": {
    id: "quest.thief_job_4",
    name: "Umbra Dominion",
    giverNpcId: "npc.dusk_ward_instructor_thief",
    requiredLevel: 100,
    objectives: [
      { kind: "kill", mobId: "mob.arc_wraith", count: 20 },
      { kind: "kill", mobId: "mob.neon_spider", count: 15 },
    ],
    rewards: {
      mesos: 50000,
      exp: 40000,
      items: ["wpn.oblivion_shard"],
      jobAdvanceToTier: 4,
    },
  },

  // ── Pirate — heartland_harbor ───────────────────────────────────────────

  /** Pirate 1st job — the harbor master initiates you. */
  "quest.pirate_job_1": {
    id: "quest.pirate_job_1",
    name: "Sworn to the Sea",
    giverNpcId: "npc.harbor_instructor_pirate",
    requiredLevel: 10,
    objectives: [{ kind: "talk", npcId: "npc.harbor_instructor_pirate" }],
    rewards: {
      mesos: 500,
      exp: 200,
      items: ["wpn.tidebreaker_gun"],
      jobAdvanceToTier: 1,
    },
  },

  /** Pirate 2nd job — clear the harbor of rat infestations. */
  "quest.pirate_job_2": {
    id: "quest.pirate_job_2",
    name: "Portside Brawl",
    giverNpcId: "npc.harbor_instructor_pirate",
    requiredLevel: 30,
    objectives: [
      { kind: "kill", mobId: "mob.dock_rat", count: 25 },
      { kind: "kill", mobId: "mob.quarry_crab", count: 10 },
    ],
    rewards: {
      mesos: 5000,
      exp: 3000,
      items: ["wpn.blunderbuss"],
      jobAdvanceToTier: 2,
    },
  },

  /** Pirate 3rd job — brave the Frosthold winds. */
  "quest.pirate_job_3": {
    id: "quest.pirate_job_3",
    name: "Tempest Captain",
    giverNpcId: "npc.harbor_instructor_pirate",
    requiredLevel: 60,
    objectives: [
      { kind: "kill", mobId: "mob.frost_wolf", count: 25 },
      { kind: "collect", itemId: "shoes.ironclad_sabatons", count: 5 },
    ],
    rewards: {
      mesos: 15000,
      exp: 12000,
      items: ["wpn.doomsayer"],
      jobAdvanceToTier: 3,
    },
  },

  /** Pirate 4th job — defeat Glacius Prime to claim your title. */
  "quest.pirate_job_4": {
    id: "quest.pirate_job_4",
    name: "Cannoneer Supreme",
    giverNpcId: "npc.harbor_instructor_pirate",
    requiredLevel: 100,
    objectives: [
      { kind: "kill", mobId: "mob.glacius_prime", count: 1 },
      { kind: "collect", itemId: "hat.dragonbone_crown", count: 3 },
    ],
    rewards: {
      mesos: 50000,
      exp: 40000,
      items: ["wpn.rampage"],
      jobAdvanceToTier: 4,
    },
  },

  // ── Drakemoor quests (Lv 90–120) ───────────────────────────────────────
  // Endgame quest chain — the pinnacle PvE content at launch.

  /** Q1: Talk to Sovereign Loremaster Vael — learn of the Dragon Sovereign. */
  "quest.drakemoor_arrival": {
    id: "quest.drakemoor_arrival",
    name: "The Dragon's Threshold",
    giverNpcId: "npc.drakemoor_guide",
    requiredLevel: 90,
    objectives: [{ kind: "talk", npcId: "npc.drakemoor_guide" }],
    rewards: { mesos: 5000, exp: 8000 },
  },

  /** Q2: Thin the jungle vipers threatening the settlement. */
  "quest.drakemoor_viper_cull": {
    id: "quest.drakemoor_viper_cull",
    name: "Serpent's Bane",
    giverNpcId: "npc.drakemoor_guide",
    requiredLevel: 90,
    prereqQuestId: "quest.drakemoor_arrival",
    objectives: [
      { kind: "kill", mobId: "mob.jungle_viper", count: 20 },
      { kind: "collect", itemId: "etc.viper_fang", count: 8 },
    ],
    rewards: { mesos: 8000, exp: 10000, items: ["wpn.voidcleaver"] },
  },

  /** Q3: Collect chitin plates from fang beetles for the armourer. */
  "quest.drakemoor_chitin_harvest": {
    id: "quest.drakemoor_chitin_harvest",
    name: "Chitin Harvest",
    giverNpcId: "npc.drakemoor_guide",
    requiredLevel: 95,
    prereqQuestId: "quest.drakemoor_viper_cull",
    objectives: [
      { kind: "kill", mobId: "mob.fang_beetle", count: 15 },
      { kind: "collect", itemId: "etc.chitin_plate", count: 10 },
    ],
    rewards: { mesos: 10000, exp: 12000, items: ["hat.dragonborne_helm"] },
  },

  /** Q4: Face the undead guardians — dragon skeletons. */
  "quest.drakemoor_bone_requiem": {
    id: "quest.drakemoor_bone_requiem",
    name: "Bone Requiem",
    giverNpcId: "npc.drakemoor_guide",
    requiredLevel: 100,
    prereqQuestId: "quest.drakemoor_chitin_harvest",
    objectives: [
      { kind: "kill", mobId: "mob.dragon_skeleton", count: 20 },
      { kind: "collect", itemId: "etc.dragon_bone", count: 8 },
    ],
    rewards: { mesos: 15000, exp: 16000, items: ["top.sovereign_plate"] },
  },

  /** Q5: Wither the vine wraiths in the upper canopy. */
  "quest.drakemoor_canopy_cleansing": {
    id: "quest.drakemoor_canopy_cleansing",
    name: "Canopy Cleansing",
    giverNpcId: "npc.drakemoor_guide",
    requiredLevel: 105,
    prereqQuestId: "quest.drakemoor_bone_requiem",
    objectives: [
      { kind: "kill", mobId: "mob.vine_wraith", count: 15 },
      { kind: "collect", itemId: "etc.withered_vine", count: 8 },
    ],
    rewards: { mesos: 18000, exp: 20000, items: ["cape.dragonfire_shroud"] },
  },

  /** Q6: Descend into the Dragon Abyss — hunt drakes and wyrms. */
  "quest.drakemoor_abyss_descent": {
    id: "quest.drakemoor_abyss_descent",
    name: "Into the Abyss",
    giverNpcId: "npc.drakemoor_guide",
    requiredLevel: 110,
    prereqQuestId: "quest.drakemoor_canopy_cleansing",
    objectives: [
      { kind: "kill", mobId: "mob.crimson_drake", count: 20 },
      { kind: "kill", mobId: "mob.shadow_wyrm", count: 10 },
    ],
    rewards: {
      mesos: 22000,
      exp: 25000,
      items: ["bottom.dragonhide_cuisses", "shoes.dragonhide_treads"],
    },
  },

  /** Q7: Face the Dragon Sovereign — defeat Pyroclasm. */
  "quest.drakemoor_sovereign_trial": {
    id: "quest.drakemoor_sovereign_trial",
    name: "The Sovereign's Trial",
    giverNpcId: "npc.drakemoor_guide",
    requiredLevel: 115,
    prereqQuestId: "quest.drakemoor_abyss_descent",
    objectives: [{ kind: "kill", mobId: "mob.pyroclasm", count: 1 }],
    rewards: {
      mesos: 50000,
      exp: 100000,
      items: ["wpn.sovereigns_edge", "hat.dragonborne_helm"],
    },
  },

  /** Q8: Prove mastery of Drakemoor — reach level 120. */
  "quest.drakemoor_dragon_master": {
    id: "quest.drakemoor_dragon_master",
    name: "Dragon Master",
    giverNpcId: "npc.drakemoor_guide",
    prereqQuestId: "quest.drakemoor_sovereign_trial",
    objectives: [{ kind: "level", level: 120 }],
    rewards: { mesos: 100000, exp: 150000, items: ["shield.dragonward_aegis"] },
  },

  // ── Drakemoor daily quests ──────────────────────────────────────────────

  /** Drakemoor daily hunt — vipers and beetles. */
  "quest.daily_drakemoor_hunt": {
    id: "quest.daily_drakemoor_hunt",
    name: "Jungle Purge",
    giverNpcId: "npc.drakemoor_guide",
    requiredLevel: 90,
    objectives: [
      { kind: "kill", mobId: "mob.jungle_viper", count: 15 },
      { kind: "kill", mobId: "mob.fang_beetle", count: 12 },
    ],
    rewards: { mesos: 8000, exp: 10000 },
    repeatable: { kind: "daily" },
  },

  /** Drakemoor daily collect — drake scales. */
  "quest.daily_drakemoor_collect": {
    id: "quest.daily_drakemoor_collect",
    name: "Scale Commission",
    giverNpcId: "npc.drakemoor_guide",
    requiredLevel: 90,
    objectives: [{ kind: "collect", itemId: "etc.drake_scale", count: 10 }],
    rewards: { mesos: 6000, exp: 8000 },
    repeatable: { kind: "daily" },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Daily Repeatable Quests
  //
  // Each region has a daily hunt and a daily collect quest.
  // These reset at UTC midnight and can be re-accepted the next day.
  // ──────────────────────────────────────────────────────────────────────────

  // ── Dawn Isle dailies ───────────────────────────────────────────────────

  /** Dawn daily hunt — kill snails and shrooms. */
  "quest.daily_dawn_hunt": {
    id: "quest.daily_dawn_hunt",
    name: "Dawn Snail Patrol",
    giverNpcId: "npc.dawn_guide",
    requiredLevel: 1,
    objectives: [
      { kind: "kill", mobId: "mob.friendly_snail", count: 10 },
      { kind: "kill", mobId: "mob.dawn_shroom", count: 5 },
    ],
    rewards: { mesos: 150, exp: 100 },
    repeatable: { kind: "daily" },
  },

  /** Dawn daily collect — gather shells. */
  "quest.daily_dawn_collect": {
    id: "quest.daily_dawn_collect",
    name: "Shell Gathering",
    giverNpcId: "npc.dawn_guide",
    requiredLevel: 1,
    objectives: [{ kind: "collect", itemId: "etc.snail_shell", count: 8 }],
    rewards: { mesos: 120, exp: 80 },
    repeatable: { kind: "daily" },
  },

  // ── Meadowfield dailies ─────────────────────────────────────────────────

  /** Meadow daily hunt — slimes and mushrooms. */
  "quest.daily_meadow_hunt": {
    id: "quest.daily_meadow_hunt",
    name: "Meadow Pest Control",
    giverNpcId: "npc.meadow_guide",
    requiredLevel: 8,
    objectives: [
      { kind: "kill", mobId: "mob.meadow_slime", count: 10 },
      { kind: "kill", mobId: "mob.mushroom", count: 8 },
    ],
    rewards: { mesos: 350, exp: 250 },
    repeatable: { kind: "daily" },
  },

  /** Meadow daily collect — mushroom caps. */
  "quest.daily_meadow_collect": {
    id: "quest.daily_meadow_collect",
    name: "Cap Harvest",
    giverNpcId: "npc.meadow_guide",
    requiredLevel: 8,
    objectives: [{ kind: "collect", itemId: "etc.mushroom_cap", count: 10 }],
    rewards: { mesos: 300, exp: 200 },
    repeatable: { kind: "daily" },
  },

  // ── Sylvanreach dailies ─────────────────────────────────────────────────

  /** Sylvan daily hunt — wisps and spiders. */
  "quest.daily_sylvan_hunt": {
    id: "quest.daily_sylvan_hunt",
    name: "Canopy Sweep",
    giverNpcId: "npc.sylvan_guide",
    requiredLevel: 10,
    objectives: [
      { kind: "kill", mobId: "mob.forest_wisp", count: 10 },
      { kind: "kill", mobId: "mob.bark_spider", count: 6 },
    ],
    rewards: { mesos: 450, exp: 350 },
    repeatable: { kind: "daily" },
  },

  /** Sylvan daily collect — spider silk. */
  "quest.daily_sylvan_collect": {
    id: "quest.daily_sylvan_collect",
    name: "Silk Delivery",
    giverNpcId: "npc.sylvan_guide",
    requiredLevel: 10,
    objectives: [{ kind: "collect", itemId: "etc.spider_silk", count: 8 }],
    rewards: { mesos: 400, exp: 300 },
    repeatable: { kind: "daily" },
  },

  // ── Craghold dailies ────────────────────────────────────────────────────

  /** Crag daily hunt — lizards and beetles. */
  "quest.daily_crag_hunt": {
    id: "quest.daily_crag_hunt",
    name: "Quarry Culling",
    giverNpcId: "npc.crag_guide",
    requiredLevel: 10,
    objectives: [
      { kind: "kill", mobId: "mob.rock_lizard", count: 10 },
      { kind: "kill", mobId: "mob.fossil_beetle", count: 8 },
    ],
    rewards: { mesos: 450, exp: 350 },
    repeatable: { kind: "daily" },
  },

  /** Crag daily collect — lizard scales. */
  "quest.daily_crag_collect": {
    id: "quest.daily_crag_collect",
    name: "Scale Commission",
    giverNpcId: "npc.crag_guide",
    requiredLevel: 10,
    objectives: [{ kind: "collect", itemId: "etc.lizard_scale", count: 8 }],
    rewards: { mesos: 400, exp: 300 },
    repeatable: { kind: "daily" },
  },

  // ── Dusk Ward dailies ──────────────────────────────────────────────────

  /** Dusk daily hunt — rats and drones. */
  "quest.daily_dusk_hunt": {
    id: "quest.daily_dusk_hunt",
    name: "Subway Night Shift",
    giverNpcId: "npc.dusk_guide",
    requiredLevel: 10,
    objectives: [
      { kind: "kill", mobId: "mob.neon_rat", count: 12 },
      { kind: "kill", mobId: "mob.spark_drone", count: 6 },
    ],
    rewards: { mesos: 450, exp: 350 },
    repeatable: { kind: "daily" },
  },

  /** Dusk daily collect — neon tags. */
  "quest.daily_dusk_collect": {
    id: "quest.daily_dusk_collect",
    name: "Tag Run",
    giverNpcId: "npc.dusk_guide",
    requiredLevel: 10,
    objectives: [{ kind: "collect", itemId: "etc.neon_tag", count: 8 }],
    rewards: { mesos: 400, exp: 300 },
    repeatable: { kind: "daily" },
  },

  // ── Crossway dailies ────────────────────────────────────────────────────

  /** Crossway daily hunt — hawks and sentinels. */
  "quest.daily_crossway_hunt": {
    id: "quest.daily_crossway_hunt",
    name: "Crossroads Patrol",
    giverNpcId: "npc.crossway_guide",
    requiredLevel: 15,
    objectives: [
      { kind: "kill", mobId: "mob.cliff_hawk", count: 8 },
      { kind: "kill", mobId: "mob.rail_sentinel", count: 6 },
    ],
    rewards: { mesos: 600, exp: 450 },
    repeatable: { kind: "daily" },
  },

  /** Crossway daily collect — relics. */
  "quest.daily_crossway_collect": {
    id: "quest.daily_crossway_collect",
    name: "Relic Recovery",
    giverNpcId: "npc.crossway_guide",
    requiredLevel: 15,
    objectives: [{ kind: "collect", itemId: "etc.ruins_tablet", count: 5 }],
    rewards: { mesos: 500, exp: 400 },
    repeatable: { kind: "daily" },
  },

  // ── Mirefen dailies ────────────────────────────────────────────────────

  /** Mirefen daily hunt — lurkers and toads. */
  "quest.daily_mirefen_hunt": {
    id: "quest.daily_mirefen_hunt",
    name: "Bog Patrol",
    giverNpcId: "npc.mirefen_guide",
    requiredLevel: 20,
    objectives: [
      { kind: "kill", mobId: "mob.bog_lurker", count: 10 },
      { kind: "kill", mobId: "mob.mire_toad", count: 8 },
    ],
    rewards: { mesos: 700, exp: 550 },
    repeatable: { kind: "daily" },
  },

  /** Mirefen daily collect — bog samples. */
  "quest.daily_mirefen_collect": {
    id: "quest.daily_mirefen_collect",
    name: "Sample Gathering",
    giverNpcId: "npc.mirefen_guide",
    requiredLevel: 20,
    objectives: [{ kind: "collect", itemId: "etc.bog_sample", count: 8 }],
    rewards: { mesos: 600, exp: 450 },
    repeatable: { kind: "daily" },
  },

  // ── Skyhaven dailies ────────────────────────────────────────────────────

  /** Skyhaven daily hunt — sprites and serpents. */
  "quest.daily_skyhaven_hunt": {
    id: "quest.daily_skyhaven_hunt",
    name: "Peak Sweep",
    giverNpcId: "npc.skyhaven_guide",
    requiredLevel: 30,
    objectives: [
      { kind: "kill", mobId: "mob.wind_sprite", count: 10 },
      { kind: "kill", mobId: "mob.sky_serpent", count: 6 },
    ],
    rewards: { mesos: 1200, exp: 900 },
    repeatable: { kind: "daily" },
  },

  /** Skyhaven daily collect — sky crystals. */
  "quest.daily_skyhaven_collect": {
    id: "quest.daily_skyhaven_collect",
    name: "Crystal Run",
    giverNpcId: "npc.skyhaven_guide",
    requiredLevel: 30,
    objectives: [{ kind: "collect", itemId: "etc.sky_crystal", count: 8 }],
    rewards: { mesos: 1000, exp: 750 },
    repeatable: { kind: "daily" },
  },

  // ── Frosthold dailies ───────────────────────────────────────────────────

  /** Frosthold daily hunt — wolves and elementals. */
  "quest.daily_frosthold_hunt": {
    id: "quest.daily_frosthold_hunt",
    name: "Frost Culling",
    giverNpcId: "npc.frosthold_guide",
    requiredLevel: 35,
    objectives: [
      { kind: "kill", mobId: "mob.frost_wolf", count: 10 },
      { kind: "kill", mobId: "mob.ice_elemental", count: 6 },
    ],
    rewards: { mesos: 1800, exp: 1200 },
    repeatable: { kind: "daily" },
  },

  /** Frosthold daily collect — frost fangs. */
  "quest.daily_frosthold_collect": {
    id: "quest.daily_frosthold_collect",
    name: "Fang Procurement",
    giverNpcId: "npc.frosthold_guide",
    requiredLevel: 35,
    objectives: [{ kind: "collect", itemId: "etc.frost_fang", count: 10 }],
    rewards: { mesos: 1500, exp: 1000 },
    repeatable: { kind: "daily" },
  },

  // ── Tideways dailies ─────────────────────────────────────────────────

  /** Tideways daily hunt — jellyfish and urchins. */
  "quest.daily_tideways_hunt": {
    id: "quest.daily_tideways_hunt",
    name: "Reef Patrol",
    giverNpcId: "npc.tideways_guide",
    requiredLevel: 35,
    objectives: [
      { kind: "kill", mobId: "mob.reef_jellyfish", count: 10 },
      { kind: "kill", mobId: "mob.sea_urchin", count: 8 },
    ],
    rewards: { mesos: 2200, exp: 1500 },
    repeatable: { kind: "daily" },
  },

  /** Tideways daily collect — tentacles. */
  "quest.daily_tideways_collect": {
    id: "quest.daily_tideways_collect",
    name: "Tentacle Delivery",
    giverNpcId: "npc.tideways_guide",
    requiredLevel: 35,
    objectives: [{ kind: "collect", itemId: "etc.jelly_tentacle", count: 8 }],
    rewards: { mesos: 1800, exp: 1200 },
    repeatable: { kind: "daily" },
  },

  // ── Reactor quests (Meadowfield ore veins + breakable boxes) ────────────

  /** Meadowfield gathering — mine copper ore. */
  "quest.meadow_gather": {
    id: "quest.meadow_gather",
    name: "Copper Prospector",
    giverNpcId: "npc.meadow_guide",
    requiredLevel: 10,
    objectives: [{ kind: "break", reactorKind: "ore-vein", count: 5 }],
    rewards: { mesos: 300, exp: 200 },
  },

  /** Meadowfield — activate the hidden switch. */
  "quest.meadow_mechanism": {
    id: "quest.meadow_mechanism",
    name: "The Hidden Switch",
    giverNpcId: "npc.meadow_guide",
    requiredLevel: 10,
    prereqQuestId: "quest.meadow_gather",
    objectives: [
      { kind: "break", reactorKind: "breakable-box", count: 3 },
      { kind: "interact", reactorKind: "quest-switch", count: 1 },
    ],
    rewards: { mesos: 500, exp: 300 },
  },

  /** Harbor Docks — smash crates for intel. */
  "quest.docks_smash": {
    id: "quest.docks_smash",
    name: "Smash and Grab",
    giverNpcId: "npc.harbor_guide",
    requiredLevel: 4,
    objectives: [{ kind: "break", reactorKind: "breakable-box", count: 5 }],
    rewards: { mesos: 200, exp: 150 },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return all quests whose `giverNpcId` matches the given NPC. */
export function getQuestsForNpc(npcId: string): QuestDef[] {
  return Object.values(QUESTS).filter((q) => q.giverNpcId === npcId);
}

/** Return the YYYY-MM-DD string for a given epoch-ms in UTC. */
export function utcDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Current UTC date key (YYYY-MM-DD). */
export function todayUtcKey(): string {
  return utcDateKey(Date.now());
}

/** Check whether a repeatable quest should be reset (i.e. it was turned in on a prior UTC day). */
export function isDailyResettable(qs: QuestState, nowMs: number): boolean {
  const def = QUESTS[qs.questId];
  if (!def?.repeatable || def.repeatable.kind !== "daily") return false;
  if (qs.status !== "turnedIn") return false;
  if (qs.lastTurnedInAt === undefined) return true;
  return utcDateKey(qs.lastTurnedInAt) !== utcDateKey(nowMs);
}

// ---------------------------------------------------------------------------
// Daily quests — per-region hunt/collect pairs
// ---------------------------------------------------------------------------

export const DAILY_QUESTS: readonly string[] = Object.values(QUESTS)
  .filter((q) => q.repeatable?.kind === "daily")
  .map((q) => q.id);

// ---------------------------------------------------------------------------
// Bonus Hunting — rotating daily map
// ---------------------------------------------------------------------------

/** Maps that rotate as the "Bonus Hunting" map (one per UTC day). */
export const BONUS_HUNT_MAPS: readonly string[] = [
  "dawn_isle",
  "tidewatch_harbor",
  "meadowfield",
  "sylvanreach",
  "craghold",
  "dusk_ward",
  "crossway",
  "mirefen",
  "skyhaven",
  "frosthold",
  "tideways",
  "drakemoor",
];

/** Bonus EXP multiplier applied on the daily bonus hunting map. */
export const BONUS_HUNT_EXP_MULT = 1.5;

/** Extra drop-rate multiplier on the daily bonus hunting map. */
export const BONUS_HUNT_DROP_MULT = 1.25;

/** Return the map id that is today's bonus hunting map (rotates by UTC day index). */
export function getTodayBonusMap(nowMs: number = Date.now()): string {
  const dayOfYear = Math.floor(
    (nowMs - Date.UTC(new Date(nowMs).getUTCFullYear(), 0, 0)) / 86_400_000,
  );
  const map = BONUS_HUNT_MAPS[dayOfYear % BONUS_HUNT_MAPS.length];
  if (map === undefined) {
    throw new Error("getTodayBonusMap: BONUS_HUNT_MAPS is empty");
  }
  return map;
}

/** Return the advancement quest for a given archetype and target tier. */
export function getAdvancementQuest(archetype: string, targetTier: number): QuestDef | undefined {
  return QUESTS[`quest.${archetype.toLowerCase()}_job_${targetTier}`];
}

// ---------------------------------------------------------------------------
// Daily Login Gift — server-authoritative once-per-day reward
// ---------------------------------------------------------------------------

/** Level-scaled reward tiers for the daily login gift. */
export const DAILY_LOGIN_REWARD_TIERS: readonly {
  readonly minLevel: number;
  readonly mesos: number;
  readonly exp: number;
}[] = [
  { minLevel: 1, mesos: 100, exp: 50 },
  { minLevel: 11, mesos: 300, exp: 150 },
  { minLevel: 26, mesos: 800, exp: 400 },
  { minLevel: 51, mesos: 2000, exp: 1000 },
  { minLevel: 91, mesos: 5000, exp: 2500 },
];

/** Return the mesos + EXP reward for the daily login gift at a given level. */
export function getDailyLoginReward(level: number): { mesos: number; exp: number } {
  let reward = DAILY_LOGIN_REWARD_TIERS[0] ?? { minLevel: 1, mesos: 100, exp: 50 };
  for (const tier of DAILY_LOGIN_REWARD_TIERS) {
    if (level >= tier.minLevel) reward = tier;
  }
  return { mesos: reward.mesos, exp: reward.exp };
}

/** Check whether the daily login gift is claimable (last claim was on a prior UTC day or never). */
export function canClaimDailyLoginGift(lastClaimedAt: number | undefined, nowMs: number): boolean {
  if (lastClaimedAt === undefined) return true;
  return utcDateKey(lastClaimedAt) !== utcDateKey(nowMs);
}

// ---------------------------------------------------------------------------
// Shipped-zone registry + quest validation
// ---------------------------------------------------------------------------

import { NPCS } from "./npcs.js";
import { MOBS } from "./mobs.js";
import { ITEMS } from "./items.js";
import { MAPS } from "./world.js";

/**
 * Map IDs whose portals are `comingSoon` — players cannot reach these zones.
 * Quests whose giver NPC lives here or whose objectives require mobs only
 * found here are flagged as gated.
 */
export const UNSHIPPED_ZONES: ReadonlySet<string> = new Set([
  "tideways",
  "tideways_reef",
  "tideways_abyss",
  "drakemoor",
  "drakemoor_jungle_floor",
  "drakemoor_dragon_abyss",
]);

/** Returns true if the quest's giver NPC lives on a shipped (reachable) map. */
export function isQuestOnShippedZone(questDef: QuestDef): boolean {
  const npc = NPCS[questDef.giverNpcId];
  if (!npc) return false;
  return !UNSHIPPED_ZONES.has(npc.mapId);
}

export type QuestIssueKind =
  | "giver_npc_missing"
  | "giver_on_unshipped_zone"
  | "kill_mob_missing"
  | "kill_mob_no_spawn"
  | "collect_item_missing"
  | "talk_npc_missing"
  | "reward_item_missing"
  | "prereq_missing"
  | "prereq_cycle"
  | "prereq_level_inconsistent";

export interface QuestIssue {
  readonly questId: string;
  readonly kind: QuestIssueKind;
  readonly detail: string;
}

/** Build a set of mob IDs that spawn on at least one shipped map. */
function getShippedMobIds(): Set<string> {
  const ids = new Set<string>();
  for (const map of Object.values(MAPS)) {
    if (UNSHIPPED_ZONES.has(map.id)) continue;
    for (const s of map.spawns) ids.add(s.mobId);
    if (map.bossSpawns) for (const s of map.bossSpawns) ids.add(s.mobId);
  }
  return ids;
}

/**
 * Validate every quest in the catalog. Returns an array of issues.
 * An empty array means all quests pass.
 */
export function validateAllQuests(): QuestIssue[] {
  const issues: QuestIssue[] = [];
  const shippedMobs = getShippedMobIds();
  const questIds = new Set(Object.keys(QUESTS));

  // --- 1. Cycle detection via DFS on prereq chains ---
  const visited = new Set<string>();
  const inStack = new Set<string>();
  function detectCycle(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    const def = QUESTS[id];
    if (def?.prereqQuestId && detectCycle(def.prereqQuestId)) return true;
    inStack.delete(id);
    return false;
  }
  for (const id of questIds) {
    if (detectCycle(id)) {
      issues.push({
        questId: id,
        kind: "prereq_cycle",
        detail: `prerequisite chain contains a cycle involving ${id}`,
      });
    }
  }

  // --- 2. Per-quest checks ---
  for (const def of Object.values(QUESTS)) {
    // Giver NPC
    const giverNpc = NPCS[def.giverNpcId];
    if (!giverNpc) {
      issues.push({
        questId: def.id,
        kind: "giver_npc_missing",
        detail: `giver NPC ${def.giverNpcId} not in NPCS catalog`,
      });
    } else if (UNSHIPPED_ZONES.has(giverNpc.mapId)) {
      issues.push({
        questId: def.id,
        kind: "giver_on_unshipped_zone",
        detail: `giver NPC ${def.giverNpcId} lives on unshipped map ${giverNpc.mapId}`,
      });
    }

    // Objectives
    for (const obj of def.objectives) {
      switch (obj.kind) {
        case "kill": {
          const mob = MOBS[obj.mobId];
          if (!mob) {
            issues.push({
              questId: def.id,
              kind: "kill_mob_missing",
              detail: `kill target ${obj.mobId} not in MOBS catalog`,
            });
          } else if (!shippedMobs.has(obj.mobId)) {
            issues.push({
              questId: def.id,
              kind: "kill_mob_no_spawn",
              detail: `kill target ${obj.mobId} does not spawn on any shipped map`,
            });
          }
          break;
        }
        case "collect": {
          if (!ITEMS[obj.itemId]) {
            issues.push({
              questId: def.id,
              kind: "collect_item_missing",
              detail: `collect target ${obj.itemId} not in ITEMS catalog`,
            });
          }
          break;
        }
        case "talk": {
          if (!NPCS[obj.npcId]) {
            issues.push({
              questId: def.id,
              kind: "talk_npc_missing",
              detail: `talk target ${obj.npcId} not in NPCS catalog`,
            });
          }
          break;
        }
        // level objectives have no external reference to check
      }
    }

    // Reward items
    if (def.rewards.items) {
      for (const itemId of def.rewards.items) {
        if (!ITEMS[itemId]) {
          issues.push({
            questId: def.id,
            kind: "reward_item_missing",
            detail: `reward item ${itemId} not in ITEMS catalog`,
          });
        }
      }
    }

    // Prerequisite
    if (def.prereqQuestId && !QUESTS[def.prereqQuestId]) {
      issues.push({
        questId: def.id,
        kind: "prereq_missing",
        detail: `prerequisite quest ${def.prereqQuestId} not in QUESTS catalog`,
      });
    }

    // Level consistency: if this quest has a prereq, this quest's requiredLevel
    // should be >= the prereq's requiredLevel (non-decreasing chain).
    if (def.prereqQuestId) {
      const prereq = QUESTS[def.prereqQuestId];
      if (prereq?.requiredLevel !== undefined && def.requiredLevel !== undefined) {
        if (def.requiredLevel < prereq.requiredLevel) {
          issues.push({
            questId: def.id,
            kind: "prereq_level_inconsistent",
            detail: `requiredLevel ${def.requiredLevel} < prereq ${def.prereqQuestId} requiredLevel ${prereq.requiredLevel}`,
          });
        }
      }
    }
  }

  return issues;
}
