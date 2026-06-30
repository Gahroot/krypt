import { describe, it, expect } from "vitest";
import { CONSUMABLES, SCROLLS, applyScroll, applyHealEffect } from "../src/consumables.js";
import type { ItemInstance } from "../src/items.js";
import { EquipSlot } from "../src/items.js";
import { BaseRank, PotentialTier } from "../src/rarity.js";
import { sequence } from "./rng.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeInstance(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    uid: "test-uid-001",
    defId: "wpn.bronze_shortsword",
    baseRank: BaseRank.NORMAL,
    potentialTier: PotentialTier.RARE,
    potentialLines: [],
    ...overrides,
  };
}

/** Type-safe lookup into CONSUMABLES catalog. */
function pot(id: string) {
  const c = CONSUMABLES[id];
  if (!c) throw new Error(`Missing consumable: ${id}`);
  return c;
}

/** Type-safe lookup into SCROLLS catalog. */
function scrl(id: string) {
  const s = SCROLLS[id];
  if (!s) throw new Error(`Missing scroll: ${id}`);
  return s;
}

// ─── ConsumableDef — structure & catalog ────────────────────────────────────

describe("ConsumableDef", () => {
  it("every consumable has a unique id", () => {
    const ids = Object.values(CONSUMABLES).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every consumable has a non-empty name and description", () => {
    for (const c of Object.values(CONSUMABLES)) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it("cooldownMs is non-negative", () => {
    for (const c of Object.values(CONSUMABLES)) {
      expect(c.cooldownMs).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── Heal effects ───────────────────────────────────────────────────────────

describe("heal consumables", () => {
  it("all heal effects have at least hp or mp set", () => {
    for (const c of Object.values(CONSUMABLES)) {
      if (c.effect.kind !== "heal") continue;
      expect(c.effect.hp !== undefined || c.effect.mp !== undefined).toBe(true);
    }
  });

  it("small HP potion heals 50 flat HP", () => {
    const p = pot("pot.small_hp");
    expect(p.effect.kind).toBe("heal");
    if (p.effect.kind === "heal") {
      expect(p.effect.hp).toBe(50);
      expect(p.effect.mp).toBeUndefined();
      expect(p.effect.percent).toBeUndefined();
    }
  });

  it("large HP potion heals 150 flat HP", () => {
    const p = pot("pot.large_hp");
    if (p.effect.kind === "heal") expect(p.effect.hp).toBe(150);
  });

  it("small MP potion heals 30 flat MP", () => {
    const p = pot("pot.small_mp");
    if (p.effect.kind === "heal") expect(p.effect.mp).toBe(30);
  });

  it("large MP potion heals 100 flat MP", () => {
    const p = pot("pot.large_mp");
    if (p.effect.kind === "heal") expect(p.effect.mp).toBe(100);
  });

  it("combined potions restore both HP and MP", () => {
    const s = pot("pot.combined_small");
    const l = pot("pot.combined_large");
    if (s.effect.kind === "heal" && l.effect.kind === "heal") {
      expect(s.effect.hp).toBe(50);
      expect(s.effect.mp).toBe(30);
      expect(l.effect.hp).toBe(150);
      expect(l.effect.mp).toBe(100);
    }
  });

  it("percent potions have percent flag set", () => {
    const p = pot("pot.hp_percent");
    if (p.effect.kind === "heal") {
      expect(p.effect.percent).toBe(true);
      expect(p.effect.hp).toBe(30);
    }
  });
});

// ─── Buff effects ───────────────────────────────────────────────────────────

describe("buff consumables", () => {
  it("all buff effects have positive durationMs", () => {
    for (const c of Object.values(CONSUMABLES)) {
      if (c.effect.kind !== "buff") continue;
      expect(c.effect.durationMs).toBeGreaterThan(0);
    }
  });

  it("power elixir buffs ATK and accuracy", () => {
    const c = pot("buff.power_elixir");
    if (c.effect.kind === "buff") {
      expect(c.effect.secondary.atk).toBe(15);
      expect(c.effect.secondary.accuracy).toBe(10);
      expect(c.effect.durationMs).toBe(60_000);
    }
  });

  it("swiftfoot tonic buffs speed and jump", () => {
    const c = pot("buff.swiftfoot_tonic");
    if (c.effect.kind === "buff") {
      expect(c.effect.secondary.speed).toBe(20);
      expect(c.effect.secondary.jump).toBe(15);
      expect(c.effect.durationMs).toBe(30_000);
    }
  });

  it("arcane draught buffs mAtk and critRate", () => {
    const c = pot("buff.arcane_draught");
    if (c.effect.kind === "buff") {
      expect(c.effect.secondary.mAtk).toBe(12);
      expect(c.effect.secondary.critRate).toBe(0.05);
      expect(c.effect.durationMs).toBe(45_000);
    }
  });
});

// ─── Recall effects ─────────────────────────────────────────────────────────

describe("recall consumables", () => {
  it("return scroll recalls to heartland_harbor dock", () => {
    const c = pot("scroll.return");
    if (c.effect.kind === "recall") {
      expect(c.effect.toMapId).toBe("heartland_harbor");
      expect(c.effect.toSpawnId).toBe("dock");
    }
  });

  it("return scroll has a 10s cooldown", () => {
    expect(pot("scroll.return").cooldownMs).toBe(10_000);
  });
});

// ─── ScrollDef — structure & catalog ────────────────────────────────────────

describe("ScrollDef", () => {
  it("every scroll has a unique id", () => {
    const ids = Object.values(SCROLLS).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every scroll has a valid successRate in [0, 1]", () => {
    for (const s of Object.values(SCROLLS)) {
      expect(s.successRate).toBeGreaterThanOrEqual(0);
      expect(s.successRate).toBeLessThanOrEqual(1);
    }
  });

  it("every scroll has a positive statDelta", () => {
    for (const s of Object.values(SCROLLS)) {
      expect(s.statDelta).toBeGreaterThan(0);
    }
  });

  it("every scroll targets a valid EquipSlot", () => {
    const slots = Object.values(EquipSlot);
    for (const s of Object.values(SCROLLS)) {
      expect(slots).toContain(s.targetSlot);
    }
  });
});

// ─── applyScroll — success ──────────────────────────────────────────────────

describe("applyScroll — success", () => {
  it("adds an enhancement line on success", () => {
    const item = makeInstance();
    const result = applyScroll(item, scrl("scrl.weap_atk_60"), () => 0);

    expect(result).not.toBe(item);
    expect(result.enhancements).toHaveLength(1);
    expect(result.enhancements![0]).toEqual({ statKind: "ATK", delta: 3 });
  });

  it("preserves existing enhancements when stacking", () => {
    const item = makeInstance({
      enhancements: [{ statKind: "ATK", delta: 3 }],
    });
    const result = applyScroll(item, scrl("scrl.weap_atk_60"), () => 0);

    expect(result.enhancements).toHaveLength(2);
    expect(result.enhancements![0]).toEqual({ statKind: "ATK", delta: 3 });
    expect(result.enhancements![1]).toEqual({ statKind: "ATK", delta: 3 });
  });

  it("does not mutate the original instance", () => {
    const item = makeInstance();
    applyScroll(item, scrl("scrl.weap_atk_60"), () => 0);
    expect(item.enhancements).toBeUndefined();
  });
});

// ─── applyScroll — failure ──────────────────────────────────────────────────

describe("applyScroll — failure", () => {
  it("returns the original instance when roll >= successRate", () => {
    const item = makeInstance();
    const result = applyScroll(item, scrl("scrl.weap_atk_10"), () => 0.5);
    expect(result).toBe(item);
    expect(result.enhancements).toBeUndefined();
  });

  it("failure at exactly successRate boundary", () => {
    const item = makeInstance();
    const result = applyScroll(item, scrl("scrl.weap_atk_10"), () => 0.1);
    expect(result).toBe(item);
  });

  it("success just below successRate boundary", () => {
    const item = makeInstance();
    const result = applyScroll(item, scrl("scrl.weap_atk_10"), () => 0.099);
    expect(result).not.toBe(item);
    expect(result.enhancements).toHaveLength(1);
  });
});

// ─── applyScroll — deterministic with sequence RNG ──────────────────────────

describe("applyScroll — deterministic RNG", () => {
  it("multiple scrolls follow the injected RNG sequence", () => {
    let item = makeInstance();
    const s = scrl("scrl.weap_atk_60"); // 60% success
    // 0.1 < 0.6 → success, 0.7 >= 0.6 → fail, 0.8 >= 0.6 → fail, 0.0 < 0.6 → success
    const rng = sequence([0.1, 0.7, 0.8, 0.0]);

    item = applyScroll(item, s, rng);
    expect(item.enhancements).toHaveLength(1);

    item = applyScroll(item, s, rng);
    expect(item.enhancements).toHaveLength(1);

    item = applyScroll(item, s, rng);
    expect(item.enhancements).toHaveLength(1);

    item = applyScroll(item, s, rng);
    expect(item.enhancements).toHaveLength(2);
  });
});

// ─── applyHealEffect (pure heal/clamp logic) ────────────────────────────────

describe("applyHealEffect", () => {
  it("flat HP heal restores HP", () => {
    const result = applyHealEffect({ kind: "heal", hp: 50 }, 10, 5, 100, 30);
    expect(result.hp).toBe(60);
    expect(result.mp).toBe(5);
  });

  it("flat MP heal restores MP", () => {
    const result = applyHealEffect({ kind: "heal", mp: 30 }, 50, 0, 100, 30);
    expect(result.hp).toBe(50);
    expect(result.mp).toBe(30);
  });

  it("cannot overheal past maxHp", () => {
    const result = applyHealEffect({ kind: "heal", hp: 50 }, 90, 5, 100, 30);
    expect(result.hp).toBe(100);
  });

  it("cannot overheal past maxMp", () => {
    const result = applyHealEffect({ kind: "heal", mp: 30 }, 50, 20, 100, 30);
    expect(result.mp).toBe(30);
  });

  it("percent heal scales with maxHp", () => {
    const result = applyHealEffect({ kind: "heal", hp: 30, percent: true }, 10, 5, 200, 50);
    expect(result.hp).toBe(10 + Math.floor((200 * 30) / 100)); // 10 + 60 = 70
  });

  it("percent heal cannot exceed maxHp", () => {
    const result = applyHealEffect({ kind: "heal", hp: 30, percent: true }, 80, 5, 100, 30);
    expect(result.hp).toBe(100);
  });

  it("combined HP+MP heal applies both", () => {
    const result = applyHealEffect({ kind: "heal", hp: 50, mp: 30 }, 0, 0, 100, 100);
    expect(result.hp).toBe(50);
    expect(result.mp).toBe(30);
  });

  it("effect with no hp/mp fields is a no-op", () => {
    const result = applyHealEffect({ kind: "heal" }, 50, 5, 100, 30);
    expect(result.hp).toBe(50);
    expect(result.mp).toBe(5);
  });

  it("heal from zero restores correctly", () => {
    const result = applyHealEffect({ kind: "heal", hp: 150 }, 0, 0, 150, 10);
    expect(result.hp).toBe(150);
  });

  it("small potion heal amount matches catalog", () => {
    const pot = CONSUMABLES["pot.small_hp"]!;
    const effect = pot.effect;
    expect(effect.kind).toBe("heal");
    if (effect.kind === "heal") {
      const result = applyHealEffect(effect, 20, 10, 100, 50);
      expect(result.hp).toBe(70);
      expect(result.mp).toBe(10);
    }
  });
});

// ─── Mesos buy prices ──────────────────────────────────────────────────────

describe("mesos buy prices", () => {
  it("heal potions have positive mesos prices", () => {
    const healPots = Object.values(CONSUMABLES).filter((c) => c.effect.kind === "heal");
    expect(healPots.length).toBeGreaterThan(0);
    for (const c of healPots) {
      expect(c.mesos).toBeDefined();
      expect(c.mesos!).toBeGreaterThan(0);
    }
  });

  it("pot.small_hp costs 20 mesos", () => {
    expect(pot("pot.small_hp").mesos).toBe(20);
  });

  it("pot.large_hp costs 60 mesos", () => {
    expect(pot("pot.large_hp").mesos).toBe(60);
  });

  it("pot.small_mp costs 25 mesos", () => {
    expect(pot("pot.small_mp").mesos).toBe(25);
  });

  it("pot.large_mp costs 75 mesos", () => {
    expect(pot("pot.large_mp").mesos).toBe(75);
  });

  it("pot.combined_small costs 40 mesos", () => {
    expect(pot("pot.combined_small").mesos).toBe(40);
  });

  it("pot.combined_large costs 100 mesos", () => {
    expect(pot("pot.combined_large").mesos).toBe(100);
  });

  it("pot.hp_percent costs 200 mesos", () => {
    expect(pot("pot.hp_percent").mesos).toBe(200);
  });

  it("legacy con.* potions also have mesos prices", () => {
    expect(pot("con.hp_potion_s").mesos).toBe(20);
    expect(pot("con.hp_potion_m").mesos).toBe(60);
    expect(pot("con.mp_potion_s").mesos).toBe(25);
    expect(pot("con.mp_potion_m").mesos).toBe(75);
  });

  it("price increases with potency (small < large)", () => {
    expect(pot("pot.small_hp").mesos!).toBeLessThan(pot("pot.large_hp").mesos!);
    expect(pot("pot.small_mp").mesos!).toBeLessThan(pot("pot.large_mp").mesos!);
  });
});

// ─── Catalog completeness ───────────────────────────────────────────────────

describe("catalog completeness", () => {
  it("has at least 5 consumables", () => {
    expect(Object.keys(CONSUMABLES).length).toBeGreaterThanOrEqual(5);
  });

  it("has at least 5 scrolls", () => {
    expect(Object.keys(SCROLLS).length).toBeGreaterThanOrEqual(5);
  });

  it("has heal, buff, and recall consumables", () => {
    const kinds = new Set(Object.values(CONSUMABLES).map((c) => c.effect.kind));
    expect(kinds.has("heal")).toBe(true);
    expect(kinds.has("buff")).toBe(true);
    expect(kinds.has("recall")).toBe(true);
  });
});
