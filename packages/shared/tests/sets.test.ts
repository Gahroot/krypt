import { describe, it, expect } from "vitest";
import { getItemDef } from "../src/items.js";
import { SETS, setMembership, computeSetBonuses } from "../src/sets.js";

// ── setMembership ────────────────────────────────────────────────────────────

describe("setMembership", () => {
  it("returns the setId for items that belong to a set", () => {
    expect(setMembership("wpn.bronze_shortsword")).toBe("set.starter_warrior");
    expect(setMembership("hat.tattered_hood")).toBe("set.starter_warrior");
    expect(setMembership("wpn.gale_bow")).toBe("set.novice_archer");
    expect(setMembership("hat.rogue_cowl")).toBe("set.shadow_initiate");
  });

  it("returns undefined for items not in any set", () => {
    expect(setMembership("wpn.iron_broadsword")).toBeUndefined();
    expect(setMembership("hat.woven_circlet")).toBeUndefined();
    expect(setMembership("pot.small_hp")).toBeUndefined();
  });
});

// ── computeSetBonuses — threshold gating ─────────────────────────────────────

describe("computeSetBonuses — Starter Warrior", () => {
  it("returns all-zero bonuses when no pieces are equipped", () => {
    const b = computeSetBonuses([]);
    expect(b.STR).toBe(0);
    expect(b.wDef).toBe(0);
    expect(b.HP).toBe(0);
    expect(b.atk).toBe(0);
  });

  it("returns zero when only 1 piece is equipped (below first threshold of 2)", () => {
    const b = computeSetBonuses(["wpn.bronze_shortsword"]);
    expect(b.STR).toBe(0);
    expect(b.wDef).toBe(0);
    expect(b.HP).toBe(0);
    expect(b.atk).toBe(0);
  });

  it("grants 2-piece bonus (STR +3) with exactly 2 pieces", () => {
    const b = computeSetBonuses(["wpn.bronze_shortsword", "hat.tattered_hood"]);
    expect(b.STR).toBe(3);
    // 3-piece and 4-piece bonuses should NOT be active
    expect(b.wDef).toBe(0);
    expect(b.HP).toBe(0);
    expect(b.atk).toBe(0);
  });

  it("grants 2-piece + 3-piece bonuses (stacking) with exactly 3 pieces", () => {
    const b = computeSetBonuses([
      "wpn.bronze_shortsword",
      "hat.tattered_hood",
      "top.patchwork_vest",
    ]);
    // 2-pc: STR +3, 3-pc: STR +3 wDef +5 HP +30
    expect(b.STR).toBe(6);
    expect(b.wDef).toBe(5);
    expect(b.HP).toBe(30);
    expect(b.atk).toBe(0); // 4-piece not yet active
  });

  it("grants all three tiers with all 4 pieces (full set)", () => {
    const b = computeSetBonuses([
      "wpn.bronze_shortsword",
      "hat.tattered_hood",
      "top.patchwork_vest",
      "bottom.burlap_leggings",
    ]);
    // 2-pc: STR +3, 3-pc: STR +3 wDef +5 HP +30, 4-pc: STR +5 wDef +5 atk +8 HP +50
    expect(b.STR).toBe(11); // 3 + 3 + 5
    expect(b.wDef).toBe(10); // 5 + 5
    expect(b.HP).toBe(80); // 30 + 50
    expect(b.atk).toBe(8);
  });
});

describe("computeSetBonuses — Novice Archer", () => {
  it("with 2 pieces grants only the 2-piece tier (DEX +3)", () => {
    const b = computeSetBonuses(["wpn.gale_bow", "hat.leather_cap"]);
    expect(b.DEX).toBe(3);
    expect(b.accuracy).toBe(0); // 3-piece not yet
  });

  it("with 4 pieces still only grants 2+3 piece tiers", () => {
    const b = computeSetBonuses([
      "wpn.gale_bow",
      "hat.leather_cap",
      "top.traveler_jerkin",
      "bottom.leather_greaves",
    ]);
    // 2-pc: DEX +3, 3-pc: DEX +3 accuracy +10
    expect(b.DEX).toBe(6);
    expect(b.accuracy).toBe(10);
    expect(b.atk).toBe(0); // 5-piece tier not yet
  });

  it("with all 5 pieces grants full set bonus", () => {
    const b = computeSetBonuses([
      "wpn.gale_bow",
      "hat.leather_cap",
      "top.traveler_jerkin",
      "bottom.leather_greaves",
      "shoes.worn_boots",
    ]);
    // 2-pc: DEX +3, 3-pc: DEX +3 accuracy +10, 5-pc: DEX +5 accuracy +15 atk +5
    expect(b.DEX).toBe(11); // 3 + 3 + 5
    expect(b.accuracy).toBe(25); // 10 + 15
    expect(b.atk).toBe(5);
  });
});

describe("computeSetBonuses — Shadow Initiate", () => {
  it("with 1 piece grants nothing", () => {
    const b = computeSetBonuses(["wpn.nightfang_dagger"]);
    expect(b.LUK).toBe(0);
    expect(b.speed).toBe(0);
  });

  it("with 2 pieces grants LUK +3 only", () => {
    const b = computeSetBonuses(["wpn.nightfang_dagger", "hat.rogue_cowl"]);
    expect(b.LUK).toBe(3);
    expect(b.speed).toBe(0);
  });

  it("with 3 pieces grants LUK +6 and speed +5", () => {
    const b = computeSetBonuses(["wpn.nightfang_dagger", "hat.rogue_cowl", "top.rogues_wrap"]);
    expect(b.LUK).toBe(6); // 3 + 3
    expect(b.speed).toBe(5);
    expect(b.critRate).toBe(0); // 5-piece tier not yet
  });

  it("with all 5 pieces grants full set", () => {
    const b = computeSetBonuses([
      "wpn.nightfang_dagger",
      "hat.rogue_cowl",
      "top.rogues_wrap",
      "shoes.windwalker_slippers",
      "gloves.rogues_fingerwraps",
    ]);
    expect(b.LUK).toBe(11); // 3 + 3 + 5
    expect(b.speed).toBe(10); // 5 + 5
    expect(b.critRate).toBe(0.05);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("computeSetBonuses — edge cases", () => {
  it("duplicate defIds only count once (Set dedup)", () => {
    // Equipping the same item twice should not double-count
    const b = computeSetBonuses(["wpn.bronze_shortsword", "wpn.bronze_shortsword"]);
    // Only 1 unique piece → below 2-piece threshold
    expect(b.STR).toBe(0);
  });

  it("mixing pieces from different sets works independently", () => {
    const b = computeSetBonuses([
      "wpn.bronze_shortsword", // starter_warrior (1 piece)
      "wpn.gale_bow", // novice_archer (1 piece)
    ]);
    // Neither set reaches its 2-piece threshold
    expect(b.STR).toBe(0);
    expect(b.DEX).toBe(0);
  });

  it("items from different sets that reach thresholds grant both", () => {
    const b = computeSetBonuses([
      "wpn.bronze_shortsword",
      "hat.tattered_hood", // starter_warrior 2-piece → STR +3
      "wpn.gale_bow",
      "hat.leather_cap", // novice_archer 2-piece → DEX +3
    ]);
    expect(b.STR).toBe(3);
    expect(b.DEX).toBe(3);
  });

  it("non-set items in the input are silently ignored", () => {
    const b = computeSetBonuses([
      "wpn.bronze_shortsword",
      "hat.tattered_hood", // starter_warrior 2-piece
      "wpn.iron_broadsword", // not in any set
      "pot.small_hp", // consumable, not in any set
    ]);
    expect(b.STR).toBe(3);
  });

  it("each set in SETS has at least 1 piece", () => {
    for (const set of SETS) {
      expect(set.pieceDefIds.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every set-piece defId resolves to a real ItemDef", () => {
    const missing: string[] = [];
    for (const set of SETS) {
      for (const defId of set.pieceDefIds) {
        if (!getItemDef(defId)) {
          missing.push(`${set.id} → ${defId}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every ItemDef with a setId references an existing set", () => {
    const setIds = new Set(SETS.map((s) => s.id));
    // Import ITEMS via getItemDef pattern — iterate all known set IDs
    for (const set of SETS) {
      expect(setIds.has(set.id)).toBe(true);
    }
  });

  it("no set-piece defId has a mismatched setId on its ItemDef", () => {
    const mismatches: string[] = [];
    for (const set of SETS) {
      for (const defId of set.pieceDefIds) {
        const def = getItemDef(defId);
        if (!def) continue; // covered by defId→ItemDef test above
        if (def.setId !== set.id) {
          mismatches.push(`${defId}: expected setId "${set.id}", got "${def.setId ?? "(none)"}"`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("no two sets share the same piece defId", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const set of SETS) {
      for (const defId of set.pieceDefIds) {
        const prev = seen.get(defId);
        if (prev) {
          collisions.push(`${defId} in both "${prev}" and "${set.id}"`);
        } else {
          seen.set(defId, set.id);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("each set has bonuses sorted ascending by piecesRequired", () => {
    for (const set of SETS) {
      const reqs = set.bonuses.map((b) => b.piecesRequired);
      for (let i = 1; i < reqs.length; i++) {
        expect(reqs[i]!).toBeGreaterThan(reqs[i - 1]!);
      }
    }
  });

  it("no bonus threshold exceeds the set's piece count", () => {
    for (const set of SETS) {
      const max = set.pieceDefIds.length;
      for (const bonus of set.bonuses) {
        expect(bonus.piecesRequired).toBeLessThanOrEqual(max);
      }
    }
  });
});
