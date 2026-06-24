import { describe, it, expect } from "vitest";
import { MOBS, getMobDef, rollMesos, rollItemDrops, STARTER_MOB_ID } from "../src/mobs.js";
import { sequence } from "./rng.js";

describe("mob catalog", () => {
  it("exposes the Meadowfield starter mob", () => {
    expect(getMobDef(STARTER_MOB_ID)).toBeDefined();
    expect(MOBS[STARTER_MOB_ID].name).toBe("Meadow Slime");
  });
});

describe("rollMesos", () => {
  const mob = MOBS[STARTER_MOB_ID];

  it("returns the min at rng=0", () => {
    expect(rollMesos(mob, () => 0)).toBe(mob.mesosMin);
  });

  it("returns the max at rng→1", () => {
    expect(rollMesos(mob, () => 0.99999)).toBe(mob.mesosMax);
  });

  it("stays within range", () => {
    for (const r of [0.1, 0.33, 0.5, 0.75, 0.9]) {
      const v = rollMesos(mob, () => r);
      expect(v).toBeGreaterThanOrEqual(mob.mesosMin);
      expect(v).toBeLessThanOrEqual(mob.mesosMax);
    }
  });
});

describe("rollItemDrops", () => {
  const mob = MOBS[STARTER_MOB_ID];

  it("drops everything when every check passes (rng=0)", () => {
    const drops = rollItemDrops(mob, () => 0);
    expect(drops).toEqual(mob.dropTable.map((e) => e.itemId));
  });

  it("drops nothing when every check fails (rng→1)", () => {
    expect(rollItemDrops(mob, () => 0.99999)).toEqual([]);
  });

  it("respects per-entry chance independently", () => {
    // First entry chance 0.05, second 0.04. Feed 0.01 (pass) then 0.5 (fail).
    const drops = rollItemDrops(mob, sequence([0.01, 0.5]));
    expect(drops).toEqual([mob.dropTable[0].itemId]);
  });
});
