import { describe, it, expect } from "vitest";
import {
  AP_PER_LEVEL,
  SP_PER_LEVEL,
  BASE_STATS,
  BASE_SECONDARY,
  PHYS_ATK_WEIGHTS,
  MGL_ATK_WEIGHTS,
  totalApByLevel,
  totalSpByLevel,
  autoAssign,
  spendAp,
  deriveSecondary,
  attackPower,
} from "../src/stats.js";
import type { CharacterStats, SecondaryStats } from "../src/stats.js";

describe("AP / SP per level", () => {
  it("grants 5 AP per level", () => {
    expect(AP_PER_LEVEL).toBe(5);
  });

  it("level 1 has 0 spendable AP", () => {
    expect(totalApByLevel(1)).toBe(0);
  });

  it("AP accrues 5 per level", () => {
    expect(totalApByLevel(2)).toBe(5);
    expect(totalApByLevel(10)).toBe(45);
    expect(totalApByLevel(50)).toBe(245);
  });

  it("SP accrues per level", () => {
    expect(totalSpByLevel(1)).toBe(0);
    expect(totalSpByLevel(10)).toBe((10 - 1) * SP_PER_LEVEL);
  });

  it("rejects invalid levels", () => {
    expect(() => totalApByLevel(0)).toThrow();
    expect(() => totalApByLevel(1.5)).toThrow();
  });
});

describe("autoAssign", () => {
  it("dumps every earned AP into the primary stat", () => {
    const stats = autoAssign(10, "STR");
    expect(stats.STR).toBe(BASE_STATS.STR + 45);
    // non-primary stays at base
    expect(stats.DEX).toBe(BASE_STATS.DEX);
    expect(stats.INT).toBe(BASE_STATS.INT);
    expect(stats.LUK).toBe(BASE_STATS.LUK);
  });

  it("level 1 equals base stats", () => {
    expect(autoAssign(1, "STR")).toEqual({ ...BASE_STATS });
  });
});

describe("spendAp", () => {
  it("is immutable and adds +1 to a primary stat", () => {
    const before = autoAssign(1, "STR");
    const after = spendAp(before, "STR");
    expect(after.STR).toBe(before.STR + 1);
    expect(before.STR).toBe(BASE_STATS.STR); // original untouched
  });

  it("HP/MP gain more than 1 per point", () => {
    const base = autoAssign(1, "STR");
    expect(spendAp(base, "HP").HP).toBe(base.HP + 10);
    expect(spendAp(base, "MP").MP).toBe(base.MP + 6);
  });
});

describe("deriveSecondary", () => {
  const level100Str: CharacterStats = {
    STR: 400,
    DEX: 100,
    INT: 30,
    LUK: 50,
    HP: 500,
    MP: 50,
  };

  it("returns base secondary stats when all primary stats are 0", () => {
    const zero: CharacterStats = { STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 50, MP: 5 };
    const sec = deriveSecondary(zero, "STR");
    expect(sec.atk).toBe(0);
    expect(sec.mAtk).toBe(0);
    expect(sec.wDef).toBe(BASE_SECONDARY.wDef);
    expect(sec.mDef).toBe(BASE_SECONDARY.mDef);
    expect(sec.critRate).toBe(BASE_SECONDARY.critRate);
    expect(sec.speed).toBe(BASE_SECONDARY.speed);
    expect(sec.jump).toBe(BASE_SECONDARY.jump);
    expect(sec.accuracy).toBe(0);
  });

  it("physical ATK scales correctly for STR-primary warrior", () => {
    const sec = deriveSecondary(level100Str, "STR");
    const [wStr, wDex, wLuk] = PHYS_ATK_WEIGHTS["STR"];
    const expected = Math.floor(
      level100Str.STR * wStr + level100Str.DEX * wDex + level100Str.LUK * wLuk,
    );
    expect(sec.atk).toBe(expected);
  });

  it("physical ATK scales correctly for DEX-primary archer", () => {
    const archerStats: CharacterStats = {
      STR: 80,
      DEX: 350,
      INT: 30,
      LUK: 60,
      HP: 400,
      MP: 50,
    };
    const sec = deriveSecondary(archerStats, "DEX");
    const [wStr, wDex, wLuk] = PHYS_ATK_WEIGHTS["DEX"];
    const expected = Math.floor(
      archerStats.STR * wStr + archerStats.DEX * wDex + archerStats.LUK * wLuk,
    );
    expect(sec.atk).toBe(expected);
  });

  it("mAtk is dominant for INT-primary mage", () => {
    const mageStats: CharacterStats = {
      STR: 20,
      DEX: 30,
      INT: 500,
      LUK: 100,
      HP: 300,
      MP: 200,
    };
    const sec = deriveSecondary(mageStats, "INT");
    const [wInt, wMluk] = MGL_ATK_WEIGHTS["INT"];
    const expectedMAtk = Math.floor(mageStats.INT * wInt + mageStats.LUK * wMluk);
    expect(sec.mAtk).toBe(expectedMAtk);
    // Physical ATK should be low for a mage
    expect(sec.atk).toBeLessThan(expectedMAtk);
  });

  it("LUK-primary thief scales physical ATK from LUK", () => {
    const thiefStats: CharacterStats = {
      STR: 40,
      DEX: 80,
      INT: 25,
      LUK: 400,
      HP: 350,
      MP: 60,
    };
    const sec = deriveSecondary(thiefStats, "LUK");
    const [wStr, wDex, wLuk] = PHYS_ATK_WEIGHTS["LUK"];
    const expected = Math.floor(
      thiefStats.STR * wStr + thiefStats.DEX * wDex + thiefStats.LUK * wLuk,
    );
    expect(sec.atk).toBe(expected);
  });

  it("accuracy derives from all four primary stats", () => {
    const sec = deriveSecondary(level100Str, "STR");
    const expected = Math.floor(
      level100Str.STR * 0.1 + level100Str.DEX * 0.5 + level100Str.INT * 0.2 + level100Str.LUK * 0.3,
    );
    expect(sec.accuracy).toBe(expected);
  });

  it("equipment bonuses add on top of derived base stats", () => {
    const bonus: Partial<SecondaryStats> = {
      atk: 50,
      mAtk: 30,
      wDef: 100,
      mDef: 80,
      critRate: 0.1,
      speed: 15,
      jump: 10,
      accuracy: 40,
    };
    const base = deriveSecondary(level100Str, "STR");
    const withEquip = deriveSecondary(level100Str, "STR", bonus);

    expect(withEquip.atk).toBe(base.atk + 50);
    expect(withEquip.mAtk).toBe(base.mAtk + 30);
    expect(withEquip.wDef).toBe(base.wDef + 100);
    expect(withEquip.mDef).toBe(base.mDef + 80);
    expect(withEquip.critRate).toBeCloseTo(base.critRate + 0.1);
    expect(withEquip.speed).toBe(base.speed + 15);
    expect(withEquip.jump).toBe(base.jump + 10);
    expect(withEquip.accuracy).toBe(base.accuracy + 40);
  });

  it("partial equip bonus only overrides specified fields", () => {
    const partial: Partial<SecondaryStats> = { atk: 10, speed: 20 };
    const base = deriveSecondary(level100Str, "STR");
    const result = deriveSecondary(level100Str, "STR", partial);

    expect(result.atk).toBe(base.atk + 10);
    expect(result.speed).toBe(base.speed + 20);
    // everything else unchanged
    expect(result.wDef).toBe(base.wDef);
    expect(result.critRate).toBeCloseTo(base.critRate);
    expect(result.jump).toBe(base.jump);
  });

  it("is pure — same inputs always produce same output", () => {
    const a = deriveSecondary(level100Str, "STR", { atk: 5, speed: 10 });
    const b = deriveSecondary(level100Str, "STR", { atk: 5, speed: 10 });
    expect(a).toEqual(b);
  });

  it("critRate default is small (5%)", () => {
    const sec = deriveSecondary(level100Str, "STR");
    expect(sec.critRate).toBe(0.05);
  });

  it("base speed and jump are 100", () => {
    const sec = deriveSecondary(level100Str, "STR");
    expect(sec.speed).toBe(100);
    expect(sec.jump).toBe(100);
  });
});

describe("attackPower (delegates to deriveSecondary)", () => {
  it("returns the same atk as deriveSecondary", () => {
    const stats: CharacterStats = {
      STR: 300,
      DEX: 100,
      INT: 20,
      LUK: 50,
      HP: 400,
      MP: 40,
    };
    expect(attackPower(stats, "STR")).toBe(deriveSecondary(stats, "STR").atk);
  });

  it("handles all primary stat archetypes", () => {
    const stats: CharacterStats = {
      STR: 200,
      DEX: 200,
      INT: 200,
      LUK: 200,
      HP: 500,
      MP: 100,
    };
    for (const primary of ["STR", "DEX", "INT", "LUK"] as const) {
      expect(attackPower(stats, primary)).toBe(deriveSecondary(stats, primary).atk);
    }
  });
});
