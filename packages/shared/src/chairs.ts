/**
 * Chair / Sit system — collectible furniture items that players can sit on.
 * Sitting boosts HP/MP regen and adds social idle activities to towns.
 */

// ─── Chair definitions ─────────────────────────────────────────────────────

export interface ChairDef {
  readonly id: string;
  readonly name: string;
  /** Item def id in the ITEMS catalog. */
  readonly itemId: string;
  /** Regen multiplier when sitting (1.0 = no bonus, 2.0 = double regen). */
  readonly regenMultiplier: number;
  /** Visual scale for the chair sprite. */
  readonly spriteScale: number;
  /** Y offset from player position for chair rendering. */
  readonly yOffset: number;
  /** Description for tooltip. */
  readonly description: string;
}

/** Chair catalog — maps item def ids to chair properties. */
export const CHAIRS: Record<string, ChairDef> = {
  "chair.red_wooden": {
    id: "chair.red_wooden",
    name: "Red Wooden Chair",
    itemId: "chair.red_wooden",
    regenMultiplier: 1.5,
    spriteScale: 0.8,
    yOffset: 12,
    description: "A sturdy red wooden chair. Comfortable for a short rest.",
  },
  "chair.blue_wooden": {
    id: "chair.blue_wooden",
    name: "Blue Wooden Chair",
    itemId: "chair.blue_wooden",
    regenMultiplier: 1.5,
    spriteScale: 0.8,
    yOffset: 12,
    description: "A cozy blue wooden chair. Perfect for watching the sunset.",
  },
  "chair.golden_throne": {
    id: "chair.golden_throne",
    name: "Golden Throne",
    itemId: "chair.golden_throne",
    regenMultiplier: 2.5,
    spriteScale: 1.0,
    yOffset: 8,
    description: "A magnificent golden throne. Only the worthiest may sit here.",
  },
  "chair.cloud_cushion": {
    id: "chair.cloud_cushion",
    name: "Cloud Cushion",
    itemId: "chair.cloud_cushion",
    regenMultiplier: 2.0,
    spriteScale: 0.9,
    yOffset: 10,
    description: "A fluffy cloud-shaped cushion. Feel the sky beneath you.",
  },
};

/** Look up a chair def by its id. */
export function getChairDef(chairId: string): ChairDef | undefined {
  return CHAIRS[chairId];
}

/** Look up a chair def by its item def id. */
export function getChairByItemId(itemId: string): ChairDef | undefined {
  return Object.values(CHAIRS).find((c) => c.itemId === itemId);
}

// ─── Sitting state constants ───────────────────────────────────────────────

/** Minimum level to use chairs (trivial, but prevents brand-new characters from sitting). */
export const CHAIR_LEVEL_REQ = 1;

/** Whether sitting is allowed on the current map (true for town maps). */
export const SIT_ALLOWED_MAPS = new Set([
  "dawn_isle",
  "heartland_harbor",
  "meadowfield",
  "sylvanreach",
  "craghold",
  "dusk_ward",
  "mirefen_marsh",
]);
