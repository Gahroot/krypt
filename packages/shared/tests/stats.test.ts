import { describe, it, expect } from "vitest";
import {
  AP_PER_LEVEL,
  SP_PER_LEVEL,
  BASE_STATS,
  totalApByLevel,
  totalSpByLevel,
  autoAssign,
  spendAp,
} from "../src/stats.js";

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
