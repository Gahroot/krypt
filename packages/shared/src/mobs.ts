/**
 * Mobs — monster definitions + drop tables for the Meadowfield starter zone.
 *
 * A drop roll has two independent stages (both public + testable):
 *   1. Does an item drop at all?  (per-entry `chance`)
 *   2. If it drops, what Potential tier does it roll?  (rarity.rollPotential)
 * This mirrors MapleStory: most kills give mesos + maybe a common item; the rare god-roll is the
 * lottery on top.
 */

export interface DropTableEntry {
  readonly itemId: string;
  /** Probability in [0, 1] that this item drops per kill. */
  readonly chance: number;
}

export interface MobDef {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly maxHp: number;
  /** EXP granted on kill. */
  readonly exp: number;
  /** Mesos drop range (inclusive). */
  readonly mesosMin: number;
  readonly mesosMax: number;
  /** Movement speed in px/tick for server wander. */
  readonly speed: number;
  readonly dropTable: readonly DropTableEntry[];
}

export const MOBS: Record<string, MobDef> = {
  "mob.meadow_slime": {
    id: "mob.meadow_slime",
    name: "Meadow Slime",
    level: 2,
    maxHp: 30,
    exp: 6,
    mesosMin: 3,
    mesosMax: 12,
    speed: 0.5,
    dropTable: [
      { itemId: "wpn.bronze_shortsword", chance: 0.05 },
      { itemId: "hat.leather_cap", chance: 0.04 },
    ],
  },
  "mob.thornback_hopper": {
    id: "mob.thornback_hopper",
    name: "Thornback Hopper",
    level: 6,
    maxHp: 70,
    exp: 14,
    mesosMin: 8,
    mesosMax: 25,
    speed: 0.9,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.03 },
      { itemId: "top.traveler_jerkin", chance: 0.05 },
    ],
  },
};

export function getMobDef(id: string): MobDef | undefined {
  return MOBS[id];
}

/** The mob that spawns in the Meadowfield slice. */
export const STARTER_MOB_ID = "mob.meadow_slime";

/**
 * Roll mesos for a kill in [mesosMin, mesosMax].
 * @param rng float in [0, 1); inject for tests.
 */
export function rollMesos(mob: MobDef, rng: () => number = Math.random): number {
  const span = mob.mesosMax - mob.mesosMin;
  return mob.mesosMin + Math.floor(rng() * (span + 1));
}

/**
 * Roll which item ids (if any) drop from a kill. Each drop-table entry is an independent check.
 * @param rng float in [0, 1); inject for tests.
 */
export function rollItemDrops(mob: MobDef, rng: () => number = Math.random): string[] {
  const drops: string[] = [];
  for (const entry of mob.dropTable) {
    if (rng() < entry.chance) drops.push(entry.itemId);
  }
  return drops;
}
