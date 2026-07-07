/**
 * Fishing minigame system — server-authoritative reward rolls, fish catalog,
 * and fishing spot definitions. Downtime activity at dock/harbor maps.
 */

// ─── Fish reward table ─────────────────────────────────────────────────────

export type FishRarity = "common" | "uncommon" | "rare";

export interface FishEntry {
  readonly id: string;
  readonly name: string;
  readonly rarity: FishRarity;
  /** Base mesos reward for catching this fish. */
  readonly mesos: number;
  /** Base EXP reward for catching this fish. */
  readonly exp: number;
  /** Drop chance weight (higher = more common). */
  readonly weight: number;
}

/** Fish reward table — weights determine relative drop rates. */
export const FISH_TABLE: readonly FishEntry[] = [
  // Common (60% total weight)
  { id: "fish.sardine", name: "Sardine", rarity: "common", mesos: 15, exp: 5, weight: 30 },
  { id: "fish.old_boot", name: "Old Boot", rarity: "common", mesos: 2, exp: 2, weight: 15 },
  { id: "fish.tin_can", name: "Tin Can", rarity: "common", mesos: 1, exp: 1, weight: 15 },

  // Uncommon (30% total weight)
  {
    id: "fish.silver_bass",
    name: "Silver Bass",
    rarity: "uncommon",
    mesos: 40,
    exp: 15,
    weight: 20,
  },
  {
    id: "fish.rainbow_trout",
    name: "Rainbow Trout",
    rarity: "uncommon",
    mesos: 60,
    exp: 20,
    weight: 10,
  },

  // Rare (10% total weight)
  { id: "fish.golden_carp", name: "Golden Carp", rarity: "rare", mesos: 150, exp: 50, weight: 8 },
  {
    id: "fish.crystal_pike",
    name: "Crystal Pike",
    rarity: "rare",
    mesos: 300,
    exp: 100,
    weight: 2,
  },
];

/** Total weight across all fish entries. */
const TOTAL_WEIGHT = FISH_TABLE.reduce((sum, f) => sum + f.weight, 0);

/**
 * Server-authoritative fish roll. Returns the fish entry based on weighted random selection.
 * Uses a seeded RNG for deterministic testing.
 */
export function rollFish(rng: () => number = Math.random): FishEntry {
  let roll = rng() * TOTAL_WEIGHT;
  for (const fish of FISH_TABLE) {
    roll -= fish.weight;
    if (roll <= 0) return fish;
  }
  // Fallback (should never happen)
  const first = FISH_TABLE[0];
  if (!first) throw new Error("FISH_TABLE is empty");
  return first;
}

// ─── Fishing spot definitions ──────────────────────────────────────────────

export interface FishingSpot {
  readonly id: string;
  readonly mapId: string;
  /** X position of the fishing spot on the map. */
  readonly x: number;
  /** Y position of the fishing spot. */
  readonly y: number;
  /** Range within which the player must stand to fish. */
  readonly interactRange: number;
  /** Base delay (ms) before a fish bites. Actual delay is randomized ±30%. */
  readonly baseBiteDelayMs: number;
  /** Base reaction window (ms) for the timing minigame. Gets tighter with consecutive catches. */
  readonly baseReactionWindowMs: number;
}

/** Fishing spots available in the world. */
export const FISHING_SPOTS: readonly FishingSpot[] = [
  {
    id: "harbor_docks:spot1",
    mapId: "harbor_docks",
    x: 1200,
    y: 500,
    interactRange: 60,
    baseBiteDelayMs: 4000,
    baseReactionWindowMs: 2500,
  },
];

/** Look up fishing spots for a given map. */
export function getFishingSpotsForMap(mapId: string): readonly FishingSpot[] {
  return FISHING_SPOTS.filter((s) => s.mapId === mapId);
}

// ─── Fishing state constants ───────────────────────────────────────────────

/** Cooldown (ms) between fishing casts. Prevents spam-casting. */
export const FISHING_CAST_COOLDOWN_MS = 1000;

/** Maximum consecutive catches before the reaction window stops shrinking. */
export const FISHING_MAX_STREAK = 10;

/** Each consecutive catch reduces the reaction window by this percentage (min 800ms). */
export const FISHING_WINDOW_SHRINK_PERCENT = 0.05;

/** Minimum reaction window (ms) — floor for the shrinking difficulty. */
export const FISHING_MIN_REACTION_WINDOW_MS = 800;

/** Mesos cost to buy bait (bait item def id for future use). */
export const BAIT_COST_MESOS = 5;
