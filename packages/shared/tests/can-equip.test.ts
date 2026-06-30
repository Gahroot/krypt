import { describe, it, expect } from "vitest";
import { ClassArchetype } from "../src/classes.js";
import { canEquip, getItemDef } from "../src/items.js";
import type { CharacterStats } from "../src/stats.js";

/** Helper: build a CharacterStats object, defaulting unspecified fields to 0. */
function stats(overrides: Partial<CharacterStats> = {}): CharacterStats {
  return { STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0, MP: 0, ...overrides };
}

describe("canEquip", () => {
  // ── Level gating ──────────────────────────────────────────────────
  it("fails when level is below levelReq", () => {
    const def = getItemDef("wpn.iron_broadsword")!;
    const result = canEquip(def, {
      level: 5,
      stats: stats({ STR: 50, DEX: 20 }),
      archetype: ClassArchetype.WARRIOR,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("level 10");
  });

  it("passes when level meets levelReq exactly", () => {
    const def = getItemDef("wpn.iron_broadsword")!;
    const result = canEquip(def, {
      level: 10,
      stats: stats({ STR: 50, DEX: 20 }),
      archetype: ClassArchetype.WARRIOR,
    });
    expect(result.ok).toBe(true);
  });

  // ── Class gating ──────────────────────────────────────────────────
  it("fails when class does not match classReq", () => {
    const def = getItemDef("wpn.gale_bow")!;
    const result = canEquip(def, {
      level: 10,
      stats: stats({ STR: 20, DEX: 50 }),
      archetype: ClassArchetype.WARRIOR,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("ARCHER");
  });

  it("passes when class matches classReq", () => {
    const def = getItemDef("wpn.gale_bow")!;
    const result = canEquip(def, {
      level: 10,
      stats: stats({ STR: 20, DEX: 50 }),
      archetype: ClassArchetype.ARCHER,
    });
    expect(result.ok).toBe(true);
  });

  it("passes items without classReq for any archetype", () => {
    const def = getItemDef("wpn.bronze_shortsword")!;
    const result = canEquip(def, {
      level: 1,
      stats: stats({ STR: 4 }),
      archetype: ClassArchetype.MAGE,
    });
    expect(result.ok).toBe(true);
  });

  // ── Stat requirements ─────────────────────────────────────────────
  it("fails when STR is below reqStr", () => {
    const def = getItemDef("wpn.iron_broadsword")!;
    // iron_broadsword requires reqStr 35
    const result = canEquip(def, {
      level: 10,
      stats: stats({ STR: 20, DEX: 20 }),
      archetype: ClassArchetype.WARRIOR,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("35 STR");
  });

  it("fails when DEX is below reqDex", () => {
    const def = getItemDef("wpn.gale_bow")!;
    // gale_bow requires reqDex 35, reqStr 10
    const result = canEquip(def, {
      level: 10,
      stats: stats({ STR: 10, DEX: 20 }),
      archetype: ClassArchetype.ARCHER,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("35 DEX");
  });

  it("fails when INT is below reqInt", () => {
    const def = getItemDef("wpn.ember_wand")!;
    // ember_wand requires reqInt 35, reqDex 15
    const result = canEquip(def, {
      level: 10,
      stats: stats({ DEX: 15, INT: 20 }),
      archetype: ClassArchetype.MAGE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("35 INT");
  });

  it("fails when LUK is below reqLuk", () => {
    const def = getItemDef("wpn.nightfang_dagger")!;
    // nightfang_dagger requires reqLuk 35, reqDex 15
    const result = canEquip(def, {
      level: 10,
      stats: stats({ DEX: 15, LUK: 20 }),
      archetype: ClassArchetype.THIEF,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("35 LUK");
  });

  it("passes when all stat requirements are met", () => {
    const def = getItemDef("wpn.iron_broadsword")!;
    const result = canEquip(def, {
      level: 10,
      stats: stats({ STR: 50, DEX: 20 }),
      archetype: ClassArchetype.WARRIOR,
    });
    expect(result.ok).toBe(true);
  });

  it("passes hat with reqStr 4 when STR >= 4", () => {
    const def = getItemDef("hat.tattered_hood")!;
    const result = canEquip(def, {
      level: 5,
      stats: stats({ STR: 4 }),
      archetype: ClassArchetype.BEGINNER,
    });
    expect(result.ok).toBe(true);
  });

  it("passes hat with reqStr 15 when STR >= 15", () => {
    const def = getItemDef("hat.leather_cap")!;
    const result = canEquip(def, {
      level: 10,
      stats: stats({ STR: 15 }),
      archetype: ClassArchetype.BEGINNER,
    });
    expect(result.ok).toBe(true);
  });

  // ── Priority: level > class > stat ────────────────────────────────
  it("reports level failure before class failure", () => {
    const def = getItemDef("wpn.gale_bow")!;
    const result = canEquip(def, {
      level: 1,
      stats: stats({ DEX: 50 }),
      archetype: ClassArchetype.WARRIOR,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("level");
    expect(result.reason).not.toContain("ARCHER");
  });

  it("reports class failure before stat failure", () => {
    const def = getItemDef("wpn.gale_bow")!;
    const result = canEquip(def, {
      level: 10,
      stats: stats({ DEX: 10 }),
      archetype: ClassArchetype.WARRIOR,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("ARCHER");
    expect(result.reason).not.toContain("DEX");
  });

  // ── No stat requirements → pass ───────────────────────────────────
  it("passes when item has no stat requirements", () => {
    // bronze_shortsword only requires reqStr 4 — easily met
    const def = getItemDef("wpn.bronze_shortsword")!;
    const result = canEquip(def, {
      level: 1,
      stats: stats({ STR: 4 }),
      archetype: ClassArchetype.BEGINNER,
    });
    expect(result.ok).toBe(true);
  });
});
