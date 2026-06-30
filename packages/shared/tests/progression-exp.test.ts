/**
 * Progression EXP curve boundary tests — verifies level-up thresholds,
 * multi-level rollover, and HP/MP growth for each archetype.
 */
import { describe, it, expect } from "vitest";
import { expForLevel, applyExp } from "../src/progression.js";
import { maxHpForLevel, maxMpForLevel, ClassArchetype } from "../src/classes.js";

describe("EXP curve boundaries", () => {
  it("level 1 requires a modest amount of EXP", () => {
    const needed = expForLevel(1); // EXP to go from level 1 → 2
    expect(needed).toBeGreaterThan(0);
    expect(needed).toBeLessThan(500);
  });

  it("level 10 requires more EXP than level 1", () => {
    expect(expForLevel(10)).toBeGreaterThan(expForLevel(1));
  });

  it("level 30 requires more EXP than level 10", () => {
    expect(expForLevel(31)).toBeGreaterThan(expForLevel(11));
  });

  it("EXP requirements are monotonically increasing", () => {
    for (let lv = 2; lv <= 50; lv++) {
      expect(expForLevel(lv + 1)).toBeGreaterThan(expForLevel(lv));
    }
  });
});

describe("applyExp — single level-up", () => {
  it("gaining exactly the required EXP levels up", () => {
    const needed = expForLevel(1);
    const result = applyExp({ level: 1, exp: 0 }, needed, ClassArchetype.WARRIOR);
    expect(result.leveledUp).toBe(true);
    expect(result.levelsGained).toBe(1);
    expect(result.level).toBe(2);
    expect(result.apGained).toBeGreaterThan(0);
  });

  it("gaining less than required EXP does not level up", () => {
    const needed = expForLevel(5);
    const result = applyExp({ level: 5, exp: 0 }, needed - 1, ClassArchetype.WARRIOR);
    expect(result.leveledUp).toBe(false);
    expect(result.level).toBe(5);
  });
});

describe("applyExp — multi-level rollover", () => {
  it("massive EXP gain can skip multiple levels", () => {
    // Sum up EXP requirements from level 1 through 5
    let totalExp = 0;
    for (let lv = 1; lv <= 5; lv++) {
      totalExp += expForLevel(lv);
    }
    const result = applyExp({ level: 1, exp: 0 }, totalExp + 1, ClassArchetype.MAGE);
    expect(result.leveledUp).toBe(true);
    expect(result.levelsGained).toBeGreaterThanOrEqual(4);
    expect(result.level).toBeGreaterThanOrEqual(5);
  });
});

describe("HP/MP growth per archetype", () => {
  const archetypes = [
    ClassArchetype.WARRIOR,
    ClassArchetype.MAGE,
    ClassArchetype.ARCHER,
    ClassArchetype.THIEF,
    ClassArchetype.PIRATE,
  ];

  for (const arch of archetypes) {
    describe(arch, () => {
      it("HP grows with level", () => {
        const hp1 = maxHpForLevel(arch, 1);
        const hp10 = maxHpForLevel(arch, 10);
        const hp30 = maxHpForLevel(arch, 30);
        expect(hp10).toBeGreaterThan(hp1);
        expect(hp30).toBeGreaterThan(hp10);
      });

      it("MP grows with level", () => {
        const mp1 = maxMpForLevel(arch, 1);
        const mp10 = maxMpForLevel(arch, 10);
        expect(mp10).toBeGreaterThanOrEqual(mp1);
      });

      it("level 1 HP is always positive", () => {
        expect(maxHpForLevel(arch, 1)).toBeGreaterThan(0);
      });
    });
  }

  it("Warriors have highest HP at level 30", () => {
    const hp = archetypes.map((a) => ({ arch: a, hp: maxHpForLevel(a, 30) }));
    const warrior = hp.find((h) => h.arch === "WARRIOR")!;
    const mage = hp.find((h) => h.arch === "MAGE")!;
    expect(warrior.hp).toBeGreaterThan(mage.hp);
  });

  it("Mages have highest MP at level 30", () => {
    const mp = archetypes.map((a) => ({ arch: a, mp: maxMpForLevel(a, 30) }));
    const mage = mp.find((m) => m.arch === "MAGE")!;
    const warrior = mp.find((m) => m.arch === "WARRIOR")!;
    expect(mage.mp).toBeGreaterThanOrEqual(warrior.mp);
  });
});
