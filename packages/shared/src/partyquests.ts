/**
 * Party Quests (PQ) — iconic early-game group content.
 *
 * Each PQ is a multi-stage instanced run with a shared objective, a countdown
 * timer, and completion rewards (exp, mesos, items + a unique PQ-set equip).
 * Stages are ordered; the party must complete each stage's objective to advance.
 * If the timer expires before all stages are cleared the PQ fails.
 *
 * Stage objectives are a discriminated union so the server can evaluate each
 * kind independently without runtime type checks leaking into the data layer.
 */

// ── Stage objective types (discriminated union) ────────────────────────────

export interface KillCountObjective {
  readonly kind: "kill-count";
  /** Mob def id — must resolve to a key in the MOBS catalog. */
  readonly mobId: string;
  /** Total kills the party must share to clear this stage. */
  readonly count: number;
}

export interface CollectObjective {
  readonly kind: "collect";
  /** Item def id — must resolve to a key in the ITEMS catalog. */
  readonly itemId: string;
  /** Total items the party must collectively gather. */
  readonly count: number;
}

export interface ReachPortalObjective {
  readonly kind: "reach-portal";
  /** Portal id within the PQ instance map that the party must reach. */
  readonly portalId: string;
}

export interface SolveObjective {
  readonly kind: "solve";
  /** Unique puzzle id the server evaluates. */
  readonly puzzleId: string;
  /** Number of times the puzzle must be solved (e.g. multi-round riddles). */
  readonly count: number;
}

/** Any PQ stage objective. Narrow with `obj.kind` before accessing kind-specific fields. */
export type PQObjective =
  | KillCountObjective
  | CollectObjective
  | ReachPortalObjective
  | SolveObjective;

// ── Stage definition ───────────────────────────────────────────────────────

export interface PQStageDef {
  /** Ordinal position (0-based) — stages must be ordered in the def. */
  readonly ordinal: number;
  /** Short label shown in the UI (e.g. "Slay the Slimes"). */
  readonly label: string;
  /** The objective to clear before advancing. */
  readonly objective: PQObjective;
}

// ── Reward set ─────────────────────────────────────────────────────────────

export interface PQRewardSet {
  readonly exp: number;
  readonly mesos: number;
  /** Item def ids granted to every completing member. */
  readonly items: readonly string[];
  /**
   * Def id of a unique PQ-set equip piece granted on completion.
   * This piece belongs to a matching PQ set defined in sets.ts.
   */
  readonly setEquipDefId: string;
}

// ── Party Quest definition ─────────────────────────────────────────────────

export interface PartyQuestDef {
  /** Stable string id (e.g. "pq.mushroomking"). */
  readonly id: string;
  readonly name: string;
  /** Minimum character level to enter. */
  readonly minLevel: number;
  /** Maximum character level to enter (0 = no cap). */
  readonly maxLevel: number;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** Total time limit in seconds for the entire run. */
  readonly timeLimitSec: number;
  /** Ordered stages — must be contiguous ordinals starting at 0. */
  readonly stages: readonly PQStageDef[];
  /** Completion rewards (same for every qualifying member). */
  readonly rewards: PQRewardSet;
}

// ── Runtime progress types ─────────────────────────────────────────────────

export interface PQStageProgress {
  /** Number of units completed so far for the current objective. */
  current: number;
  /** Target count (set from the stage def). */
  readonly target: number;
  readonly kind: string;
}

export type PQRunStatus = "waiting" | "countdown" | "active" | "success" | "failed";

// ── Catalog ────────────────────────────────────────────────────────────────

export const PARTY_QUESTS: Record<string, PartyQuestDef> = {
  // ── Mushroom King's Castle — the classic starter PQ ─────────────────────
  "pq.mushroomking": {
    id: "pq.mushroomking",
    name: "Mushroom King's Castle",
    minLevel: 1,
    maxLevel: 25,
    minPlayers: 1,
    maxPlayers: 6,
    timeLimitSec: 600, // 10 minutes
    stages: [
      {
        ordinal: 0,
        label: "Slay the Mushrooms",
        objective: { kind: "kill-count", mobId: "mob.green_mushroom", count: 10 },
      },
      {
        ordinal: 1,
        label: "Collect Spores",
        objective: { kind: "collect", itemId: "item.mushroom_spore", count: 5 },
      },
      {
        ordinal: 2,
        label: "Enter the Throne Room",
        objective: { kind: "reach-portal", portalId: "portal.throne_room" },
      },
    ],
    rewards: {
      exp: 1200,
      mesos: 5000,
      items: ["item.hp_potion_large"],
      setEquipDefId: "equip.pq_mushroom_helm",
    },
  },

  // ── Dusk Ward Subway PQ — Kerning City PQ parity (Lv 20–30) ────────────
  "pq.dusk_subway": {
    id: "pq.dusk_subway",
    name: "Dusk Ward Subway Rush",
    minLevel: 20,
    maxLevel: 35,
    minPlayers: 2,
    maxPlayers: 6,
    timeLimitSec: 1200, // 20 minutes
    stages: [
      {
        ordinal: 0,
        label: "Collect Subway Passes",
        objective: { kind: "collect", itemId: "item.subway_pass", count: 30 },
      },
      {
        ordinal: 1,
        label: "Slay the Overseers",
        objective: { kind: "kill-count", mobId: "mob.subway_overseer", count: 20 },
      },
      {
        ordinal: 2,
        label: "Cross the Broken Rails",
        objective: { kind: "reach-portal", portalId: "pq_enter_stage3" },
      },
      {
        ordinal: 3,
        label: "Solve the Signal Puzzle",
        objective: { kind: "solve", puzzleId: "puzzle.subway_signal", count: 3 },
      },
      {
        ordinal: 4,
        label: "Defeat the Gaze of the Abyss",
        objective: { kind: "reach-portal", portalId: "pq_complete" },
      },
    ],
    rewards: {
      exp: 5000,
      mesos: 20000,
      items: ["pot.combined_large", "pot.combined_large"],
      setEquipDefId: "top.pq_subway_vest",
    },
  },

  // ── Slime Pit — quick 5-minute endurance run ────────────────────────────
  "pq.slimepit": {
    id: "pq.slimepit",
    name: "Slime Pit",
    minLevel: 5,
    maxLevel: 30,
    minPlayers: 2,
    maxPlayers: 4,
    timeLimitSec: 300, // 5 minutes
    stages: [
      {
        ordinal: 0,
        label: "Clear the Slimes",
        objective: { kind: "kill-count", mobId: "mob.blue_slime", count: 15 },
      },
      {
        ordinal: 1,
        label: "Solve the Gate Riddle",
        objective: { kind: "solve", puzzleId: "puzzle.slime_riddle", count: 3 },
      },
      {
        ordinal: 2,
        label: "Escape the Pit",
        objective: { kind: "reach-portal", portalId: "portal.slime_exit" },
      },
    ],
    rewards: {
      exp: 2500,
      mesos: 10000,
      items: ["item.mana_potion_large", "item.escargot"],
      setEquipDefId: "equip.pq_slime_cloak",
    },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Look up a PQ def by id. Returns undefined if not found. */
export function getPartyQuest(id: string): PartyQuestDef | undefined {
  return PARTY_QUESTS[id];
}

/**
 * Build initial progress for every stage of a PQ.
 */
export function createPQStageProgress(def: PartyQuestDef): PQStageProgress[] {
  return def.stages.map((s) => ({
    current: 0,
    target: s.objective.kind === "reach-portal" ? 1 : s.objective.count,
    kind: s.objective.kind,
  }));
}
