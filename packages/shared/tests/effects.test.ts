import { describe, it, expect } from "vitest";
import {
  applyEffect,
  tickEffects,
  aggregateSecondary,
  buffEffectToSecondary,
  skillBuffToStatusEffect,
  consumableBuffToStatusEffect,
  passiveEffectBonus,
  MAX_STACKS,
  type StatusEffect,
} from "../src/effects.js";
import { deriveSecondary } from "../src/stats.js";
import type { SecondaryStats, CharacterStats } from "../src/stats.js";
import { ClassArchetype } from "../src/classes.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEffect(
  overrides: Partial<StatusEffect> & Pick<StatusEffect, "id" | "kind">,
): StatusEffect {
  return {
    durationMs: 10_000,
    stacks: 1,
    source: "test",
    ...overrides,
  };
}

function makeBuff(id = "test.buff", durationMs = 10_000): StatusEffect {
  return makeEffect({ id, kind: "buff", secondary: { atk: 10 }, durationMs });
}

function makeDot(id = "test.dot", tickDamage = 20, tickMs = 1000, durationMs = 5000): StatusEffect {
  return makeEffect({ id, kind: "dot", tickDamage, tickMs, durationMs });
}

function makeHot(id = "test.hot", tickDamage = 15, tickMs = 1000, durationMs = 5000): StatusEffect {
  return makeEffect({ id, kind: "hot", tickDamage, tickMs, durationMs });
}

function makeDebuff(id = "test.debuff", durationMs = 10_000): StatusEffect {
  return makeEffect({ id, kind: "debuff", secondary: { wDef: -5, speed: -10 }, durationMs });
}

function makeStun(id = "test.stun", durationMs = 3000): StatusEffect {
  return makeEffect({ id, kind: "stun", durationMs });
}

// ═══════════════════════════════════════════════════════════════════════════════
// applyEffect — stacking & refresh
// ═══════════════════════════════════════════════════════════════════════════════

describe("applyEffect", () => {
  it("appends a new effect when no duplicate exists", () => {
    const active: StatusEffect[] = [makeBuff("a")];
    const next = makeBuff("b");
    const result = applyEffect(active, next);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const active: StatusEffect[] = [makeBuff("a")];
    const original = [...active];
    applyEffect(active, makeBuff("b"));
    expect(active).toEqual(original);
  });

  it("stacks an existing effect up to MAX_STACKS", () => {
    let active: StatusEffect[] = [makeBuff("x")];
    for (let i = 1; i < MAX_STACKS; i++) {
      active = applyEffect(active, makeBuff("x"));
    }
    expect(active).toHaveLength(1);
    expect(active[0]!.stacks).toBe(MAX_STACKS);
  });

  it("caps stacking at MAX_STACKS (does not exceed)", () => {
    let active: StatusEffect[] = [makeBuff("x")];
    for (let i = 0; i < MAX_STACKS + 5; i++) {
      active = applyEffect(active, makeBuff("x"));
    }
    expect(active[0]!.stacks).toBe(MAX_STACKS);
  });

  it("refreshes duration when stacking", () => {
    const original = makeBuff("x", 5000);
    const active: StatusEffect[] = [original];
    const refreshed = applyEffect(active, makeBuff("x", 10_000));
    expect(refreshed[0]!.durationMs).toBe(10_000);
  });

  it("refreshes duration even at max stacks", () => {
    let active: StatusEffect[] = [makeBuff("x", 1000)];
    for (let i = 0; i < MAX_STACKS; i++) {
      active = applyEffect(active, makeBuff("x"));
    }
    // Now refresh with a longer duration
    active = applyEffect(active, makeBuff("x", 20_000));
    expect(active[0]!.stacks).toBe(MAX_STACKS);
    expect(active[0]!.durationMs).toBe(20_000);
  });

  it("handles multiple independent effects", () => {
    let active: StatusEffect[] = [];
    active = applyEffect(active, makeBuff("a"));
    active = applyEffect(active, makeBuff("b"));
    active = applyEffect(active, makeBuff("c"));
    expect(active).toHaveLength(3);

    // Stack "a" again
    active = applyEffect(active, makeBuff("a"));
    expect(active).toHaveLength(3);
    expect(active.find((e) => e.id === "a")!.stacks).toBe(2);
  });

  it("stacks debuffs", () => {
    let active: StatusEffect[] = [];
    active = applyEffect(active, makeDebuff("slow"));
    active = applyEffect(active, makeDebuff("slow"));
    active = applyEffect(active, makeDebuff("slow"));
    expect(active[0]!.stacks).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// tickEffects — expiry
// ═══════════════════════════════════════════════════════════════════════════════

describe("tickEffects — expiry", () => {
  it("removes an effect when elapsed >= durationMs", () => {
    const effect = makeBuff("x", 1000);
    const elapsed = new Map<string, number>([["x", 900]]);

    const result = tickEffects([effect], 200, elapsed);
    expect(result.active).toHaveLength(0);
    expect(elapsed.has("x")).toBe(false);
  });

  it("keeps an effect when elapsed < durationMs", () => {
    const effect = makeBuff("x", 1000);
    const elapsed = new Map<string, number>([["x", 500]]);

    const result = tickEffects([effect], 200, elapsed);
    expect(result.active).toHaveLength(1);
    expect(elapsed.get("x")).toBe(700);
  });

  it("removes only expired effects, keeps the rest", () => {
    const a = makeBuff("a", 500);
    const b = makeBuff("b", 2000);
    const elapsed = new Map<string, number>([
      ["a", 400],
      ["b", 100],
    ]);

    const result = tickEffects([a, b], 200, elapsed);
    expect(result.active.map((e) => e.id)).toEqual(["b"]);
  });

  it("returns empty array when all effects expire", () => {
    const effects = [makeBuff("a", 100), makeBuff("b", 200)];
    const elapsed = new Map<string, number>([
      ["a", 50],
      ["b", 100],
    ]);

    const result = tickEffects(effects, 200, elapsed);
    expect(result.active).toHaveLength(0);
  });

  it("initializes elapsed to 0 for effects not yet in the map", () => {
    const effect = makeBuff("new", 1000);
    const elapsed = new Map<string, number>();

    const result = tickEffects([effect], 500, elapsed);
    expect(result.active).toHaveLength(1);
    expect(elapsed.get("new")).toBe(500);
  });

  it("does not mutate input effects", () => {
    const effect = makeBuff("x", 10_000);
    const snapshot = { ...effect };
    const elapsed = new Map<string, number>();

    tickEffects([effect], 100, elapsed);
    expect(effect).toEqual(snapshot);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// tickEffects — DoT ticking
// ═══════════════════════════════════════════════════════════════════════════════

describe("tickEffects — DoT ticking", () => {
  it("fires one tick when elapsed crosses a tickMs boundary", () => {
    const dot = makeDot("poison", 20, 1000, 10_000);
    const elapsed = new Map<string, number>([["poison", 0]]);

    const result = tickEffects([dot], 1000, elapsed);
    expect(result.hpDelta).toBe(-20); // 1 tick × 20 damage
  });

  it("fires multiple ticks when dtMs spans multiple intervals", () => {
    const dot = makeDot("poison", 10, 500, 10_000);
    const elapsed = new Map<string, number>([["poison", 0]]);

    // 2000ms / 500ms = 4 ticks
    const result = tickEffects([dot], 2000, elapsed);
    expect(result.hpDelta).toBe(-40); // 4 ticks × 10
  });

  it("accounts for stacks in damage calculation", () => {
    const dot = { ...makeDot("poison", 10, 1000, 10_000), stacks: 3 };
    const elapsed = new Map<string, number>([["poison", 0]]);

    const result = tickEffects([dot], 1000, elapsed);
    expect(result.hpDelta).toBe(-30); // 1 tick × 10 × 3 stacks
  });

  it("does not fire a tick on the exact boundary start (0 → 0)", () => {
    const dot = makeDot("poison", 10, 1000, 10_000);
    const elapsed = new Map<string, number>([["poison", 0]]);

    const result = tickEffects([dot], 0, elapsed);
    expect(result.hpDelta).toBe(0);
  });

  it("fires no additional tick when elapsed stays within same interval", () => {
    const dot = makeDot("poison", 20, 1000, 10_000);
    const elapsed = new Map<string, number>([["poison", 0]]);

    // First tick at 1000ms
    const r1 = tickEffects([dot], 1000, elapsed);
    expect(r1.hpDelta).toBe(-20);

    // Second tick at 1500ms — no new boundary crossed
    const r2 = tickEffects([dot], 500, elapsed);
    expect(r2.hpDelta).toBe(0);
  });

  it("fires the correct number of ticks across partial intervals", () => {
    const dot = makeDot("burn", 5, 1000, 10_000);
    const elapsed = new Map<string, number>([["burn", 200]]);

    // elapsed 200 + dtMs 1800 = 2000 → floor(2000/1000) - floor(200/1000) = 2 - 0 = 2
    const result = tickEffects([dot], 1800, elapsed);
    expect(result.hpDelta).toBe(-10); // 2 ticks × 5
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// tickEffects — HoT ticking
// ═══════════════════════════════════════════════════════════════════════════════

describe("tickEffects — HoT ticking", () => {
  it("produces positive hpDelta for heal-over-time", () => {
    const hot = makeHot("regen", 15, 1000, 10_000);
    const elapsed = new Map<string, number>([["regen", 0]]);

    const result = tickEffects([hot], 1000, elapsed);
    expect(result.hpDelta).toBe(15);
  });

  it("HoT with stacks heals proportionally", () => {
    const hot = { ...makeHot("regen", 10, 1000, 10_000), stacks: 4 };
    const elapsed = new Map<string, number>([["regen", 0]]);

    const result = tickEffects([hot], 1000, elapsed);
    expect(result.hpDelta).toBe(40); // 10 × 4
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// tickEffects — combined scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("tickEffects — combined scenarios", () => {
  it("handles DoT + HoT simultaneously", () => {
    const dot = makeDot("poison", 10, 1000, 10_000);
    const hot = makeHot("regen", 5, 1000, 10_000);
    const elapsed = new Map<string, number>([
      ["poison", 0],
      ["regen", 0],
    ]);

    const result = tickEffects([dot, hot], 1000, elapsed);
    // -10 (dot) + 5 (hot) = -5
    expect(result.hpDelta).toBe(-5);
  });

  it("effect expiry happens before tick processing in the same frame", () => {
    // Effect expires at exactly dtMs, so no tick should fire
    const dot = makeDot("burn", 100, 1000, 1000);
    const elapsed = new Map<string, number>([["burn", 0]]);

    const result = tickEffects([dot], 1000, elapsed);
    // expired (1000 >= 1000), so no tick fires
    expect(result.active).toHaveLength(0);
    expect(result.hpDelta).toBe(0);
  });

  it("handles mixed effect kinds with partial expiry", () => {
    const buff = makeBuff("buff_short", 500);
    const dot = makeDot("poison", 5, 500, 10_000);
    const elapsed = new Map<string, number>([
      ["buff_short", 300],
      ["poison", 0],
    ]);

    const result = tickEffects([buff, dot], 300, elapsed);
    // buff_short: 300 + 300 = 600 >= 500 → expired
    // poison: 0 + 300 = 300 → floor(300/500) = 0 ticks
    expect(result.active.map((e) => e.id)).toEqual(["poison"]);
    expect(result.hpDelta).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// aggregateSecondary
// ═══════════════════════════════════════════════════════════════════════════════

describe("aggregateSecondary", () => {
  it("returns empty object for no active effects", () => {
    expect(aggregateSecondary([])).toEqual({});
  });

  it("sums buff secondary modifiers", () => {
    const effects: StatusEffect[] = [
      makeEffect({ id: "a", kind: "buff", secondary: { atk: 10 } }),
      makeEffect({ id: "b", kind: "buff", secondary: { atk: 5, mAtk: 3 } }),
    ];
    const delta = aggregateSecondary(effects);
    expect(delta).toEqual({ atk: 15, mAtk: 3 });
  });

  it("subtracts debuff secondary modifiers", () => {
    const effects: StatusEffect[] = [
      makeEffect({ id: "slow", kind: "debuff", secondary: { speed: -10 } }),
    ];
    const delta = aggregateSecondary(effects);
    expect(delta).toEqual({ speed: -10 });
  });

  it("buffs and debuffs of same id cancel out (different ids)", () => {
    const effects: StatusEffect[] = [
      makeEffect({ id: "atk_up", kind: "buff", secondary: { atk: 10 } }),
      makeEffect({ id: "atk_down", kind: "debuff", secondary: { atk: -4 } }),
    ];
    const delta = aggregateSecondary(effects);
    expect(delta).toEqual({ atk: 6 });
  });

  it("ignores dot, hot, and stun effects", () => {
    const effects: StatusEffect[] = [
      makeDot("poison", 10, 1000, 5000),
      makeHot("regen", 5, 1000, 5000),
      makeStun("stun", 3000),
    ];
    const delta = aggregateSecondary(effects);
    expect(delta).toEqual({});
  });

  it("multiplies by stacks", () => {
    const effects: StatusEffect[] = [
      makeEffect({ id: "rally", kind: "buff", secondary: { atk: 10 }, stacks: 3 }),
    ];
    const delta = aggregateSecondary(effects);
    expect(delta).toEqual({ atk: 30 });
  });

  it("does not mutate input effects", () => {
    const effects: StatusEffect[] = [makeEffect({ id: "a", kind: "buff", secondary: { atk: 10 } })];
    const snapshot = effects.map((e) => ({ ...e }));
    aggregateSecondary(effects);
    expect(effects).toEqual(snapshot);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buffEffectToSecondary
// ═══════════════════════════════════════════════════════════════════════════════

describe("buffEffectToSecondary", () => {
  it("maps atkPercent to atk", () => {
    expect(buffEffectToSecondary({ atkPercent: 15 })).toEqual({ atk: 15 });
  });

  it("maps defPercent to wDef + mDef", () => {
    expect(buffEffectToSecondary({ defPercent: 20 })).toEqual({ wDef: 20, mDef: 20 });
  });

  it("maps speed", () => {
    expect(buffEffectToSecondary({ speed: 10 })).toEqual({ speed: 10 });
  });

  it("returns empty for mpPercent (handled separately)", () => {
    expect(buffEffectToSecondary({ mpPercent: 10 })).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// skillBuffToStatusEffect
// ═══════════════════════════════════════════════════════════════════════════════

describe("skillBuffToStatusEffect", () => {
  it("creates a buff StatusEffect from a BuffEffect", () => {
    const effect = skillBuffToStatusEffect(
      "warrior.rally",
      { atkPercent: 15 },
      10_000,
      "player:42",
    );
    expect(effect).toEqual({
      id: "warrior.rally",
      kind: "buff",
      secondary: { atk: 15 },
      durationMs: 10_000,
      stacks: 1,
      source: "player:42",
    });
  });

  it("can be fed directly into applyEffect", () => {
    const newBuff = skillBuffToStatusEffect("warrior.rally", { atkPercent: 15 }, 10_000, "p1");
    const active = applyEffect([], newBuff);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe("warrior.rally");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// consumableBuffToStatusEffect
// ═══════════════════════════════════════════════════════════════════════════════

describe("consumableBuffToStatusEffect", () => {
  it("creates a buff from consumable secondary stats", () => {
    const effect = consumableBuffToStatusEffect(
      "buff.power_elixir",
      { atk: 15, accuracy: 10 },
      60_000,
      "player:7",
    );
    expect(effect).toEqual({
      id: "buff.power_elixir",
      kind: "buff",
      secondary: { atk: 15, accuracy: 10 },
      durationMs: 60_000,
      stacks: 1,
      source: "player:7",
    });
  });

  it("integrates with applyEffect + aggregateSecondary end-to-end", () => {
    const buff = consumableBuffToStatusEffect(
      "buff.swiftfoot_tonic",
      { speed: 20, jump: 15 },
      30_000,
      "player:1",
    );
    const active = applyEffect([], buff);
    const delta = aggregateSecondary(active);
    expect(delta).toEqual({ speed: 20, jump: 15 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: apply → tick → aggregate round-trip
// ═══════════════════════════════════════════════════════════════════════════════

describe("integration: full effect lifecycle", () => {
  it("apply → tick → expire → gone", () => {
    let active: StatusEffect[] = [];
    active = applyEffect(active, makeBuff("x", 2000));
    const elapsed = new Map<string, number>();

    // Tick 1s — still alive
    let tick = tickEffects(active, 1000, elapsed);
    active = tick.active;
    expect(active).toHaveLength(1);
    expect(aggregateSecondary(active)).toEqual({ atk: 10 });

    // Tick 1s — expires (total 2000ms = durationMs)
    tick = tickEffects(active, 1000, elapsed);
    active = tick.active;
    expect(active).toHaveLength(0);
    expect(aggregateSecondary(active)).toEqual({});
  });

  it("apply DoT → tick multiple times → verify cumulative damage", () => {
    const dot = makeDot("poison", 10, 1000, 10_000);
    let active: StatusEffect[] = [dot];
    const elapsed = new Map<string, number>();
    let totalHpDelta = 0;

    for (let i = 0; i < 5; i++) {
      const tick = tickEffects(active, 1000, elapsed);
      active = tick.active;
      totalHpDelta += tick.hpDelta;
    }

    expect(totalHpDelta).toBe(-50); // 5 ticks × 10
    expect(active).toHaveLength(1); // still alive (duration = 10s)
  });

  it("apply buff + debuff → aggregate cancels partially", () => {
    let active: StatusEffect[] = [];
    active = applyEffect(
      active,
      makeEffect({ id: "atk_up", kind: "buff", secondary: { atk: 20 } }),
    );
    active = applyEffect(
      active,
      makeEffect({ id: "slow", kind: "debuff", secondary: { atk: -8, speed: -15 } }),
    );

    const delta = aggregateSecondary(active);
    expect(delta).toEqual({ atk: 12, speed: -15 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// passiveEffectBonus — aggregates passive skill buffs
// ═══════════════════════════════════════════════════════════════════════════════

describe("passiveEffectBonus", () => {
  it("returns empty for an empty skill book", () => {
    const bonus = passiveEffectBonus(ClassArchetype.WARRIOR, {});
    expect(bonus).toEqual({});
  });

  it("returns passive def bonus from warrior.iron_hide", () => {
    // warrior.iron_hide is a passive with defPercent: 10
    const book: Record<string, number> = { "warrior.iron_hide": 1 };
    const bonus = passiveEffectBonus(ClassArchetype.WARRIOR, book);
    expect(bonus.wDef).toBe(10);
    expect(bonus.mDef).toBe(10);
  });

  it("returns passive speed bonus from archer.fleet_foot", () => {
    // archer.fleet_foot is a passive with speed: 8
    const book: Record<string, number> = { "archer.fleet_foot": 1 };
    const bonus = passiveEffectBonus(ClassArchetype.ARCHER, book);
    expect(bonus.speed).toBe(8);
  });

  it("ignores unlearned passives (level 0)", () => {
    const book: Record<string, number> = { "warrior.iron_hide": 0 };
    const bonus = passiveEffectBonus(ClassArchetype.WARRIOR, book);
    expect(bonus).toEqual({});
  });

  it("ignores active and buff skills", () => {
    // warrior.crushing_blow is kind: "active" — should not contribute
    const book: Record<string, number> = { "warrior.crushing_blow": 1 };
    const bonus = passiveEffectBonus(ClassArchetype.WARRIOR, book);
    expect(bonus).toEqual({});
  });

  it("ignores passives without buffEffect", () => {
    // Some passives might not have buffEffect; test with a made-up id that won't exist
    const book: Record<string, number> = { "nonexistent.passive": 1 };
    const bonus = passiveEffectBonus(ClassArchetype.WARRIOR, book);
    expect(bonus).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deriveSecondary with effectBonus
// ═══════════════════════════════════════════════════════════════════════════════

const baseStats: CharacterStats = {
  STR: 100,
  DEX: 50,
  INT: 30,
  LUK: 20,
  HP: 300,
  MP: 50,
};

describe("deriveSecondary with effectBonus", () => {
  it("adds effectBonus on top of base stats", () => {
    const base = deriveSecondary(baseStats, "STR");
    const buffed = deriveSecondary(baseStats, "STR", undefined, { atk: 15, speed: 5 });
    expect(buffed.atk).toBe(base.atk + 15);
    expect(buffed.speed).toBe(base.speed + 5);
    expect(buffed.wDef).toBe(base.wDef); // unchanged
  });

  it("applies equipBonus and effectBonus cumulatively", () => {
    const equip = { atk: 10, wDef: 20 };
    const effect = { atk: 5, speed: 8 };
    const result = deriveSecondary(baseStats, "STR", equip, effect);
    const base = deriveSecondary(baseStats, "STR");
    expect(result.atk).toBe(base.atk + 15);
    expect(result.wDef).toBe(base.wDef + 20);
    expect(result.speed).toBe(base.speed + 8);
  });

  it("backward compatible — no 4th arg works identically", () => {
    const a = deriveSecondary(baseStats, "STR");
    const b = deriveSecondary(baseStats, "STR", undefined);
    expect(a).toEqual(b);
  });

  it("works without equipBonus but with effectBonus", () => {
    const base = deriveSecondary(baseStats, "STR");
    const buffed = deriveSecondary(baseStats, "STR", undefined, { wDef: 10, mDef: 10 });
    expect(buffed.wDef).toBe(base.wDef + 10);
    expect(buffed.mDef).toBe(base.mDef + 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// End-to-end: passive + active buff → deriveSecondary
// ═══════════════════════════════════════════════════════════════════════════════

describe("end-to-end buff integration via deriveSecondary", () => {
  it("passive iron_hide increases wDef/mDef in derived stats", () => {
    const book: Record<string, number> = { "warrior.iron_hide": 1 };
    const effect = passiveEffectBonus(ClassArchetype.WARRIOR, book);
    const base = deriveSecondary(baseStats, "STR");
    const buffed = deriveSecondary(baseStats, "STR", undefined, effect);
    expect(buffed.wDef).toBe(base.wDef + 10);
    expect(buffed.mDef).toBe(base.mDef + 10);
  });

  it("active buff stacks with passive bonus in derived stats", () => {
    // Passive: warrior.iron_hide → defPercent: 10
    const book: Record<string, number> = { "warrior.iron_hide": 1 };
    const passive = passiveEffectBonus(ClassArchetype.WARRIOR, book);

    // Active buff: warrior.rally → atkPercent: 15
    const buffEffect = skillBuffToStatusEffect(
      "warrior.rally",
      { atkPercent: 15 },
      10_000,
      "player",
    );
    const active = applyEffect([], buffEffect);
    const activeBuff = aggregateSecondary(active);

    // Merge passive + active
    const merged: Record<string, number> = {};
    for (const [k, v] of Object.entries(passive)) {
      if (typeof v === "number") merged[k] = (merged[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(activeBuff)) {
      if (typeof v === "number") merged[k] = (merged[k] ?? 0) + v;
    }

    const base = deriveSecondary(baseStats, "STR");
    const fullyBuffed = deriveSecondary(
      baseStats,
      "STR",
      undefined,
      merged as Partial<SecondaryStats>,
    );
    expect(fullyBuffed.atk).toBe(base.atk + 15);
    expect(fullyBuffed.wDef).toBe(base.wDef + 10);
    expect(fullyBuffed.mDef).toBe(base.mDef + 10);
  });

  it("expired buff no longer contributes to aggregate", () => {
    let active: StatusEffect[] = [makeBuff("x", 1000)];
    const elapsed = new Map<string, number>();

    // Tick past expiry
    const result = tickEffects(active, 1001, elapsed);
    active = result.active;

    expect(active).toHaveLength(0);
    expect(aggregateSecondary(active)).toEqual({});
  });
});
