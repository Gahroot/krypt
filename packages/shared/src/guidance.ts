/**
 * Guidance — the "Maple Guide" system that always tells a new player what to do next.
 *
 * An ordered list of progression milestones keyed by level band. Each milestone
 * points at a concrete map / NPC / quest chain so the client can render a
 * "next steps" panel and offer a one-click travel button.
 *
 * Pure data + pure functions: identical results on server and client.
 */

import { QUESTS } from "./quests.js";
import { NPCS } from "./npcs.js";
import { MAPS } from "./world.js";

// ── Tutorial Chain ──────────────────────────────────────────────────────────

/** Ordered quest ids that form the Dawn Isle tutorial. Used by analytics to build a tutorial funnel. */
export const TUTORIAL_QUEST_CHAIN: readonly string[] = [
  "quest.dawn_tutorial",
  "quest.dawn_trio",
  "quest.dawn_step_jump",
  "quest.dawn_step_loot",
  "quest.dawn_step_inventory",
  "quest.dawn_level3",
  "quest.dawn_shroom_hunt",
  "quest.dawn_puff_patrol",
  "quest.dawn_ready",
  "quest.dawn_ferry",
];

// ── Types ──────────────────────────────────────────────────────────────────

/** A single step inside a milestone (quest to complete, NPC to talk to, etc.). */
export interface GuidanceStep {
  /** Short player-facing description (e.g. "Talk to Guide Iris"). */
  readonly label: string;
  /** Quest id the player should accept/complete, if any. */
  readonly questId?: string;
  /** NPC id to interact with, if any. */
  readonly npcId?: string;
}

export interface ProgressionMilestone {
  /** Unique id. */
  readonly id: string;
  /** Short title shown in the Guide panel header. */
  readonly title: string;
  /** Longer description shown below the title. */
  readonly description: string;
  /** Level band for this milestone — only visible when the player is within range. */
  readonly minLevel: number;
  readonly maxLevel: number;
  /** Ordered steps the player should complete. */
  readonly steps: readonly GuidanceStep[];
  /** Map the player should be on for this milestone. */
  readonly mapId: string;
  /** Optional NPC on the target map to walk toward. */
  readonly targetNpcId?: string;
  /** Optional map to teleport to when the "Go There" button is pressed.
   *  Defaults to `mapId`. Use a different value when the player must
   *  first travel to a hub before reaching the target map. */
  readonly teleportMapId?: string;
}

// ── Catalog ────────────────────────────────────────────────────────────────

/**
 * The full ordered milestone list covering Lv 1 → 50+.
 *
 * Each milestone maps to a concrete quest chain in `quests.ts`.
 * Milestones overlap in level bands — the server picks the *first*
 * incomplete milestone for the player's current level.
 */
export const PROGRESSION_MILESTONES: readonly ProgressionMilestone[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // DAWN ISLE — Tutorial (Lv 1–8)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.dawn_tutorial",
    title: "A New Beginning",
    description:
      "Talk to Guide Iris on Dawn Isle to learn the basics of combat, jumping, and looting.",
    minLevel: 1,
    maxLevel: 8,
    mapId: "dawn_isle",
    targetNpcId: "npc.dawn_guide",
    steps: [
      { label: "Talk to Guide Iris", questId: "quest.dawn_tutorial", npcId: "npc.dawn_guide" },
      { label: "Complete Pest Control (kill 5 snails)", questId: "quest.dawn_trio" },
      { label: "Complete Leap of Faith", questId: "quest.dawn_step_jump" },
      { label: "Complete Loot the Spoils", questId: "quest.dawn_step_loot" },
      { label: "Complete Check Your Pockets", questId: "quest.dawn_step_inventory" },
      { label: "Reach Level 3", questId: "quest.dawn_level3" },
      { label: "Complete Shroom Shakedown", questId: "quest.dawn_shroom_hunt" },
      { label: "Complete Puff Patrol", questId: "quest.dawn_puff_patrol" },
      { label: "Reach Level 8", questId: "quest.dawn_ready" },
      {
        label: "Talk to Ferrymaster Cole to leave Dawn Isle",
        questId: "quest.dawn_ferry",
        npcId: "npc.dawn_ferry",
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HEARTLAND HARBOR — First steps off the island (Lv 8–10)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.harbor_welcome",
    title: "Welcome to the Heartland",
    description:
      "You've arrived at Tidewatch Harbor. Talk to Harbormaster Lyra and explore the docks.",
    minLevel: 8,
    maxLevel: 10,
    mapId: "heartland_harbor",
    targetNpcId: "npc.harbor_guide",
    steps: [
      {
        label: "Talk to Harbormaster Lyra",
        questId: "quest.harbor_welcome",
        npcId: "npc.harbor_guide",
      },
      { label: "Complete Dock Rat Roundup", questId: "quest.harbor_rat_roundup" },
      { label: "Complete Lost Luggage", questId: "quest.harbor_lost_cargo" },
      { label: "Complete Whisker Collection", questId: "quest.harbor_rat_whiskers" },
      { label: "Complete The Captain's Log", questId: "quest.harbor_captains_log" },
      { label: "Reach Level 10", questId: "quest.harbor_ready" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 1ST JOB ADVANCEMENT — Choose your class (Lv 10)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.job_advance_1",
    title: "1st Job Advancement",
    description:
      "Reach Level 10 and choose your class! Visit the instructor in your home town: " +
      "Warrior → Craghold | Mage → Sylvanreach | Archer → Meadowfield | Thief → Dusk Ward | Pirate → Harbor.",
    minLevel: 10,
    maxLevel: 15,
    mapId: "heartland_harbor",
    targetNpcId: "npc.harbor_job",
    teleportMapId: "heartland_harbor",
    steps: [],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MEADOWFIELD — Archer / Beginner zone (Lv 10–15)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.meadowfield",
    title: "Meadowfield Meadows",
    description: "Explore Meadowfield and clear the monsters threatening the farmlands.",
    minLevel: 10,
    maxLevel: 15,
    mapId: "meadowfield",
    targetNpcId: "npc.meadow_guide",
    steps: [
      {
        label: "Talk to Elder Willow",
        questId: "quest.meadow_green_goo",
        npcId: "npc.meadow_guide",
      },
      { label: "Complete Slime Roundup", questId: "quest.meadow_slimes" },
      { label: "Complete Mushroom Madness", questId: "quest.meadow_mushroom_madness" },
      { label: "Complete Hop to It", questId: "quest.meadow_hopper_hunt" },
      { label: "Complete Crow Control", questId: "quest.meadow_crow_control" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SYLVANREACH — Mage zone (Lv 10–20)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.sylvanreach",
    title: "Sylvanreach Forest",
    description: "Enter the enchanted forest of Sylvanreach. Help Fairy Eluna protect the canopy.",
    minLevel: 10,
    maxLevel: 20,
    mapId: "sylvanreach",
    targetNpcId: "npc.sylvan_guide",
    steps: [
      { label: "Talk to Fairy Eluna", questId: "quest.sylvan_welcome", npcId: "npc.sylvan_guide" },
      { label: "Complete Forest Clearing", questId: "quest.sylvan_forest_clearing" },
      { label: "Complete Wisp Essence", questId: "quest.sylvan_wisp_essence" },
      { label: "Complete Canopy Pests", questId: "quest.sylvan_canopy_pests" },
      { label: "Complete Silk for the Weavers", questId: "quest.sylvan_spider_silk" },
      { label: "Complete Root Patrol", questId: "quest.sylvan_root_patrol" },
      { label: "Complete Sprite Dance", questId: "quest.sylvan_sprite_dance" },
      { label: "Reach Level 20 (Heart of the Forest)", questId: "quest.sylvan_heart" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CRAGHOLD — Warrior zone (Lv 10–20)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.craghold",
    title: "Craghold Plateau",
    description:
      "Brave the rocky plateau of Craghold. Forge your strength against stone and steel.",
    minLevel: 10,
    maxLevel: 20,
    mapId: "craghold",
    targetNpcId: "npc.crag_guide",
    steps: [
      {
        label: "Talk to Forge Master Korrin",
        questId: "quest.crag_welcome",
        npcId: "npc.crag_guide",
      },
      { label: "Complete Lizard Roundup", questId: "quest.crag_lizard_roundup" },
      { label: "Complete Scaled for Battle", questId: "quest.crag_scale_quest" },
      { label: "Complete Beetle Bounty", questId: "quest.crag_beetle_bounty" },
      { label: "Complete Hawk Watch", questId: "quest.crag_hawk_watch" },
      { label: "Complete Quarry Depths", questId: "quest.crag_quarry_depths" },
      { label: "Complete Cliffs and Claws", questId: "quest.crag_crab_catch" },
      { label: "Reach Level 20 (Forged in Stone)", questId: "quest.crag_iron_will" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DUSK WARD — Thief zone (Lv 10–20)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.dusk_ward",
    title: "Dusk Ward Undercity",
    description:
      "Descend into the neon-lit undercity of Dusk Ward. Clear the subway and backalleys.",
    minLevel: 10,
    maxLevel: 20,
    mapId: "dusk_ward",
    targetNpcId: "npc.dusk_guide",
    steps: [
      { label: "Talk to Fixer Nyx", questId: "quest.dusk_welcome", npcId: "npc.dusk_guide" },
      { label: "Complete Subway Sweep", questId: "quest.dusk_subway_sweep" },
      { label: "Complete Tag Collection", questId: "quest.dusk_tag_collection" },
      { label: "Complete Patrol the Rails", questId: "quest.dusk_rail_patrol" },
      { label: "Complete Drone Hunt", questId: "quest.dusk_drone_hunt" },
      { label: "Complete Backalley Cleanup", questId: "quest.dusk_backalley_cleanup" },
      { label: "Reach Level 20 (Shadow's End)", questId: "quest.dusk_shadow_end" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CROSSWAY — Hub (Lv 15–25)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.crossway",
    title: "Crossway Crossroads",
    description: "Visit the central hub of the Heartland. Meet Keeper Aldric and prove your worth.",
    minLevel: 15,
    maxLevel: 25,
    mapId: "crossway",
    targetNpcId: "npc.crossway_guide",
    steps: [
      {
        label: "Talk to Keeper Aldric",
        questId: "quest.crossway_welcome",
        npcId: "npc.crossway_guide",
      },
      { label: "Complete Heartland Messenger", questId: "quest.crossway_messenger" },
      { label: "Complete Defender of the Crossroads", questId: "quest.crossway_defender" },
      { label: "Complete Path to the Swamp", questId: "quest.crossway_escort" },
      { label: "Complete Heartland Relics", questId: "quest.crossway_relic_hunt" },
      { label: "Reach Level 25 (Heartland Champion)", questId: "quest.crossway_champion" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MIREFEN — Swamp dungeon (Lv 20–30)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.mirefen",
    title: "Mirefen Swamp",
    description:
      "Journey into the Mirefen Swamp. Help Swamplight Maren purge the bog and explore ancient ruins.",
    minLevel: 20,
    maxLevel: 30,
    mapId: "mirefen",
    targetNpcId: "npc.mirefen_guide",
    steps: [
      {
        label: "Talk to Swamplight Maren",
        questId: "quest.mirefen_welcome",
        npcId: "npc.mirefen_guide",
      },
      { label: "Complete Bog Purge", questId: "quest.mirefen_bog_purge" },
      { label: "Complete Bog Samples", questId: "quest.mirefen_bog_sample" },
      { label: "Complete Sentinel Relics", questId: "quest.mirefen_sentinel_relics" },
      { label: "Complete Tablet Recovery", questId: "quest.mirefen_tablet_quest" },
      { label: "Complete Wraith Hunt", questId: "quest.mirefen_wraith_hunt" },
      { label: "Defeat the Ruin Behemoth", questId: "quest.mirefen_ruin_behemoth" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 2ND JOB ADVANCEMENT (Lv 30)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.job_advance_2",
    title: "2nd Job Advancement",
    description:
      "Return to your class instructor for your 2nd job advancement. " +
      "Warrior → Craghold | Mage → Sylvanreach | Archer → Meadowfield | Thief → Dusk Ward | Pirate → Harbor.",
    minLevel: 30,
    maxLevel: 35,
    mapId: "crossway",
    teleportMapId: "crossway",
    steps: [],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SKYHAVEN — Far Reaches expansion (Lv 30–40)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.skyhaven",
    title: "Skyhaven — The Open Sky",
    description:
      "Travel from Crossway to Skyhaven (airship or taxi). Help Windkeeper Zara protect the Driftpeaks.",
    minLevel: 30,
    maxLevel: 40,
    mapId: "skyhaven",
    targetNpcId: "npc.skyhaven_guide",
    teleportMapId: "crossway",
    steps: [
      {
        label: "Talk to Windkeeper Zara",
        questId: "quest.skyhaven_arrival",
        npcId: "npc.skyhaven_guide",
      },
      { label: "Complete Wind Sprite Hunt", questId: "quest.skyhaven_wind_sprite_hunt" },
      { label: "Complete Crystal Gathering", questId: "quest.skyhaven_crystal_gathering" },
      { label: "Complete Serpent Hunt", questId: "quest.skyhaven_serpent_hunt" },
      { label: "Complete Thunder Hawk Flight", questId: "quest.skyhaven_thunder_hawk_flight" },
      { label: "Reach Level 40 (Sky Master)", questId: "quest.skyhaven_sky_master" },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // FROSTHOLD — Endgame expansion (Lv 35–50)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "milestone.frosthold",
    title: "Frosthold — The Frozen Edge",
    description:
      "Travel from Skyhaven to Frosthold (airship or taxi). Brave the frozen slopes and descend into the Icecave.",
    minLevel: 35,
    maxLevel: 50,
    mapId: "frosthold",
    targetNpcId: "npc.frosthold_guide",
    teleportMapId: "skyhaven",
    steps: [
      {
        label: "Talk to Frost Warden Eira",
        questId: "quest.frosthold_arrival",
        npcId: "npc.frosthold_guide",
      },
      { label: "Complete Wolf Patrol", questId: "quest.frosthold_wolf_patrol" },
      { label: "Complete Fang Collection", questId: "quest.frosthold_fang_collection" },
      { label: "Complete Elemental Purge", questId: "quest.frosthold_elemental_purge" },
      { label: "Complete Crystal Hunt", questId: "quest.frosthold_crystal_hunt" },
      { label: "Descend into the Icecave", questId: "quest.frosthold_icecave_descent" },
      { label: "Complete Revenant Hunt", questId: "quest.frosthold_revenant_hunt" },
      { label: "Complete Banshee Bane", questId: "quest.frosthold_banshee_bane" },
      { label: "Defeat the Frozen Heart", questId: "quest.frosthold_frozen_heart" },
    ],
  },
] as const;

// ── Pure computation ───────────────────────────────────────────────────────

/** Status of a single guidance step for display. */
export interface GuidanceStepStatus {
  readonly label: string;
  /** True when the player has already turned this quest in (or met the level gate). */
  readonly completed: boolean;
  /** True when this is the very next thing to do. */
  readonly active: boolean;
  /** Quest id, if this step maps to a quest. */
  readonly questId?: string;
  /** NPC id, if the player should talk to someone. */
  readonly npcId?: string;
}

/** Result of evaluating the player's current progression. */
export interface GuidanceResult {
  /** The milestone the player should be working on right now. */
  readonly milestone: ProgressionMilestone;
  /** Steps with completion status, in order. */
  readonly steps: readonly GuidanceStepStatus[];
  /** Index of the first incomplete step (-1 if all done). */
  readonly activeStepIndex: number;
  /** True when every step in the milestone is done (player should move on). */
  readonly allComplete: boolean;
}

/**
 * Determine whether a quest is "done" for guidance purposes.
 *
 * A quest is considered complete if its status is `"turnedIn"`.
 * `"complete"` (ready for turn-in) also counts as done — the player
 * has done the work and just needs to talk to the NPC, which the
 * milestone already guides them to do.
 */
function isQuestDone(
  questId: string,
  turnedInQuests: ReadonlySet<string>,
  activeQuests: ReadonlyMap<string, string>,
): boolean {
  if (turnedInQuests.has(questId)) return true;
  const status = activeQuests.get(questId);
  return status === "complete";
}

/**
 * Find the recommended milestone for a player given their level and quest progress.
 *
 * Walks the milestone list in order and returns the **first** milestone where:
 *   1. The player's level is within [minLevel, maxLevel].
 *   2. Not all steps are completed yet.
 *
 * If every milestone is done, returns the last one with `allComplete: true`.
 *
 * @param level        Player's current level.
 * @param questStates  Map of questId → status string ("available" | "active" | "complete" | "turnedIn").
 */
export function getRecommendedMilestone(
  level: number,
  questStates: ReadonlyMap<string, string>,
): GuidanceResult | null {
  if (PROGRESSION_MILESTONES.length === 0) return null;

  // Pre-compute sets for fast lookup.
  const turnedInQuests = new Set<string>();
  for (const [qId, status] of questStates) {
    if (status === "turnedIn") turnedInQuests.add(qId);
  }

  let lastResult: GuidanceResult | null = null;

  for (const milestone of PROGRESSION_MILESTONES) {
    // Skip milestones the player hasn't reached yet.
    if (level < milestone.minLevel) continue;

    // Also skip milestones the player has outleveled — they're past this band.
    if (level > milestone.maxLevel) continue;

    const steps = evaluateSteps(milestone, turnedInQuests, questStates);
    const activeIdx = steps.findIndex((s) => !s.completed);
    const allDone = activeIdx === -1;

    const result: GuidanceResult = {
      milestone,
      steps,
      activeStepIndex: activeIdx,
      allComplete: allDone,
    };

    // Return the first non-complete milestone.
    if (!allDone) return result;

    lastResult = result;
  }

  // If we get here, either everything is done or the player is between bands.
  // Return the last matching milestone (allComplete).
  return lastResult;
}

/** Evaluate each step in a milestone against the player's quest progress. */
function evaluateSteps(
  milestone: ProgressionMilestone,
  turnedInQuests: ReadonlySet<string>,
  activeQuests: ReadonlyMap<string, string>,
): GuidanceStepStatus[] {
  let foundIncomplete = false;
  return milestone.steps.map((step) => {
    if (step.questId) {
      const completed = isQuestDone(step.questId, turnedInQuests, activeQuests);
      const active = !completed && !foundIncomplete;
      if (!completed) foundIncomplete = true;
      return {
        label: step.label,
        completed,
        active,
        questId: step.questId,
        npcId: step.npcId,
      };
    }
    // Non-quest steps (e.g. "visit the instructor") — mark active only if nothing before is incomplete.
    const active = !foundIncomplete;
    foundIncomplete = true;
    return {
      label: step.label,
      completed: false,
      active,
      npcId: step.npcId,
    };
  });
}

// ── Validation helpers (used by server) ────────────────────────────────────

/** Validate that every referenced map, NPC, and quest in the milestone list exists. */
export function validateMilestones(): string[] {
  const errors: string[] = [];
  for (const m of PROGRESSION_MILESTONES) {
    if (!MAPS[m.mapId]) errors.push(`Milestone ${m.id}: unknown map "${m.mapId}"`);
    if (m.teleportMapId && !MAPS[m.teleportMapId])
      errors.push(`Milestone ${m.id}: unknown teleportMap "${m.teleportMapId}"`);
    if (m.targetNpcId && !NPCS[m.targetNpcId])
      errors.push(`Milestone ${m.id}: unknown targetNpc "${m.targetNpcId}"`);
    for (const step of m.steps) {
      if (step.questId && !QUESTS[step.questId])
        errors.push(`Milestone ${m.id}, step "${step.label}": unknown quest "${step.questId}"`);
      if (step.npcId && !NPCS[step.npcId])
        errors.push(`Milestone ${m.id}, step "${step.label}": unknown npc "${step.npcId}"`);
    }
  }
  return errors;
}

// ── Travel fee helpers ─────────────────────────────────────────────────────

/** Regions that cost 100 mesos to taxi to (Heartland towns). */
const HEARTLAND_TOWN_IDS = new Set([
  "heartland_harbor",
  "meadowfield",
  "sylvanreach",
  "craghold",
  "dusk_ward",
  "crossway",
  "mirefen",
]);

/** Regions that cost 200 mesos (Far Reaches). */
const FAR_REACHES_IDS = new Set(["skyhaven", "frosthold"]);

/**
 * Compute the mesos fee to travel from one map to another via the taxi network.
 * Returns 0 if the destination is the same map or not taxi-reachable.
 */
export function travelFee(fromMapId: string, toMapId: string): number {
  if (fromMapId === toMapId) return 0;
  // Heartland ↔ Heartland = 100
  if (HEARTLAND_TOWN_IDS.has(fromMapId) && HEARTLAND_TOWN_IDS.has(toMapId)) return 100;
  // Far Reaches ↔ Far Reaches = 200
  if (FAR_REACHES_IDS.has(fromMapId) && FAR_REACHES_IDS.has(toMapId)) return 200;
  // Heartland ↔ Far Reaches = 200
  if (
    (HEARTLAND_TOWN_IDS.has(fromMapId) && FAR_REACHES_IDS.has(toMapId)) ||
    (FAR_REACHES_IDS.has(fromMapId) && HEARTLAND_TOWN_IDS.has(toMapId))
  )
    return 200;
  return 0;
}
