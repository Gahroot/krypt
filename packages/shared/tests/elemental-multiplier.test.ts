import { describe, it, expect } from "vitest";
import { elementalMultiplier, type MobDef, type Element } from "../src/mobs.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal mob factory — only fills fields required by MobDef. */
function makeMob(overrides: Partial<MobDef> & Pick<MobDef, "element">): MobDef {
  return {
    id: "test.mob",
    name: "Test Mob",
    level: 1,
    maxHp: 100,
    exp: 1,
    mesosMin: 0,
    mesosMax: 0,
    speed: 0,
    dropTable: [],
    wDef: 0,
    mDef: 0,
    avoid: 0,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("elementalMultiplier", () => {
  // ── Neutral / baseline ────────────────────────────────────────────

  it("returns 1 for PHYSICAL mob vs any attack element", () => {
    const mob = makeMob({ element: "PHYSICAL" });
    const elements: Element[] = [
      "FIRE",
      "ICE",
      "LIGHTNING",
      "POISON",
      "HOLY",
      "DARK",
      "PHYSICAL",
      "NONE",
    ];
    for (const el of elements) {
      expect(elementalMultiplier(mob, el)).toBe(1);
    }
  });

  it("returns 1 for NONE mob vs any attack element", () => {
    const mob = makeMob({ element: "NONE" });
    expect(elementalMultiplier(mob, "FIRE")).toBe(1);
    expect(elementalMultiplier(mob, "ICE")).toBe(1);
    expect(elementalMultiplier(mob, "POISON")).toBe(1);
  });

  it("returns 1 when mob has no elementMods (undefined)", () => {
    const mob = makeMob({ element: "DARK" });
    expect(elementalMultiplier(mob, "FIRE")).toBe(1);
    expect(elementalMultiplier(mob, "PHYSICAL")).toBe(1);
  });

  // ── Immune ────────────────────────────────────────────────────────

  it("returns 0 (immune) for FIRE attack vs ICE mob with elementMods", () => {
    const mob = makeMob({
      element: "ICE",
      elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
    });
    expect(elementalMultiplier(mob, "ICE")).toBe(0);
  });

  it("returns 0 (immune) for POISON attack vs POISON mob", () => {
    const mob = makeMob({
      element: "POISON",
      elementMods: { POISON: 0, HOLY: 1.5 },
    });
    expect(elementalMultiplier(mob, "POISON")).toBe(0);
  });

  it("returns 0 (immune) for DARK attack vs DARK mob", () => {
    const mob = makeMob({
      element: "DARK",
      elementMods: { DARK: 0, HOLY: 1.5 },
    });
    expect(elementalMultiplier(mob, "DARK")).toBe(0);
  });

  // ── Weak (1.5×) ──────────────────────────────────────────────────

  it("returns 1.5 (weak) for FIRE attack vs ICE mob", () => {
    const mob = makeMob({
      element: "ICE",
      elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
    });
    expect(elementalMultiplier(mob, "FIRE")).toBe(1.5);
  });

  it("returns 1.5 (weak) for LIGHTNING attack vs ICE mob", () => {
    const mob = makeMob({
      element: "ICE",
      elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
    });
    expect(elementalMultiplier(mob, "LIGHTNING")).toBe(1.5);
  });

  it("returns 1.5 (weak) for HOLY attack vs POISON mob", () => {
    const mob = makeMob({
      element: "POISON",
      elementMods: { POISON: 0, HOLY: 1.5 },
    });
    expect(elementalMultiplier(mob, "HOLY")).toBe(1.5);
  });

  it("returns 1.5 (weak) for HOLY attack vs DARK mob", () => {
    const mob = makeMob({
      element: "DARK",
      elementMods: { DARK: 0, HOLY: 1.5 },
    });
    expect(elementalMultiplier(mob, "HOLY")).toBe(1.5);
  });

  it("returns 1.5 (weak) for DARK attack vs HOLY mob", () => {
    const mob = makeMob({
      element: "HOLY",
      elementMods: { HOLY: 0, DARK: 1.5 },
    });
    expect(elementalMultiplier(mob, "DARK")).toBe(1.5);
  });

  // ── Neutral fallback for unmapped elements ────────────────────────

  it("returns 1 for unmapped attack element against an elemental mob", () => {
    const mob = makeMob({
      element: "ICE",
      elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
    });
    // POISON is not in the ICE mob's elementMods → defaults to 1
    expect(elementalMultiplier(mob, "POISON")).toBe(1);
    expect(elementalMultiplier(mob, "DARK")).toBe(1);
    expect(elementalMultiplier(mob, "HOLY")).toBe(1);
    expect(elementalMultiplier(mob, "PHYSICAL")).toBe(1);
    expect(elementalMultiplier(mob, "NONE")).toBe(1);
  });

  it("returns 1 for PHYSICAL attack vs ICE mob with elementMods", () => {
    const mob = makeMob({
      element: "ICE",
      elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
    });
    expect(elementalMultiplier(mob, "PHYSICAL")).toBe(1);
  });

  // ── Resist (0.5) ─────────────────────────────────────────────────

  it("returns 0.5 (resist) when elementMods explicitly sets 0.5", () => {
    const mob = makeMob({
      element: "FIRE",
      elementMods: { FIRE: 0, ICE: 1.5, LIGHTNING: 0.5 },
    });
    expect(elementalMultiplier(mob, "LIGHTNING")).toBe(0.5);
  });

  // ── Boss with full elementMods ───────────────────────────────────

  it("boss ICE elementMods: immune to ICE, weak to FIRE and LIGHTNING", () => {
    const boss = makeMob({
      id: "mob.glacius_prime",
      name: "Glacius Prime",
      element: "ICE",
      elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
      isBoss: true,
    });
    expect(elementalMultiplier(boss, "ICE")).toBe(0);
    expect(elementalMultiplier(boss, "FIRE")).toBe(1.5);
    expect(elementalMultiplier(boss, "LIGHTNING")).toBe(1.5);
    expect(elementalMultiplier(boss, "PHYSICAL")).toBe(1);
    expect(elementalMultiplier(boss, "POISON")).toBe(1);
  });
});
