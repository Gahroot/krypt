import { describe, it, expect } from "vitest";
import { ITEMS, EquipSlot } from "../src/items.js";
import { ClassArchetype } from "../src/classes.js";

/** Non-weapon slots that must have armor entries. */
const ARMOR_SLOTS: EquipSlot[] = [
  EquipSlot.HAT,
  EquipSlot.TOP,
  EquipSlot.BOTTOM,
  EquipSlot.SHOES,
  EquipSlot.GLOVES,
  EquipSlot.CAPE,
  EquipSlot.SHIELD,
  EquipSlot.OVERALL,
  EquipSlot.RING,
  EquipSlot.EARRING,
  EquipSlot.PENDANT,
  EquipSlot.BELT,
  EquipSlot.FACE_ACCESSORY,
  EquipSlot.EYE_ACCESSORY,
  EquipSlot.SHOULDER,
  EquipSlot.MEDAL,
  EquipSlot.BADGE,
  EquipSlot.POCKET,
];

/** All items belonging to a given armor slot, sorted by levelReq ascending. */
function armorForSlot(slot: EquipSlot) {
  return Object.values(ITEMS)
    .filter((item) => item.slot === slot)
    .sort((a, b) => a.levelReq - b.levelReq);
}

describe("armor catalog — every slot has entries", () => {
  for (const slot of ARMOR_SLOTS) {
    it(`${slot} has at least one entry`, () => {
      const items = armorForSlot(slot);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("armor catalog — defense ascends per level band", () => {
  for (const slot of ARMOR_SLOTS) {
    it(`${slot}: wDef and mDef increase across level bands`, () => {
      const items = armorForSlot(slot);
      // We need at least the level bands we care about.
      // Group by levelReq, then verify the defense of each subsequent band is >= the previous.
      const levelBands = [...new Set(items.map((i) => i.levelReq))].sort((a, b) => a - b);

      // For each slot, pick the highest-defense item per band (since some bands
      // have multiple items e.g. class-agnostic + class-flavored).
      const bandBest = levelBands.map((lv) => {
        const atLevel = items.filter((i) => i.levelReq === lv);
        return {
          lv,
          wDef: Math.max(...atLevel.map((i) => i.wDef ?? 0)),
          mDef: Math.max(...atLevel.map((i) => i.mDef ?? 0)),
        };
      });

      for (let i = 1; i < bandBest.length; i++) {
        const prev = bandBest[i - 1]!;
        const cur = bandBest[i]!;
        // At least one of wDef or mDef must strictly increase.
        const wDefUp = cur.wDef > prev.wDef;
        const mDefUp = cur.mDef > prev.mDef;
        expect(
          wDefUp || mDefUp,
          `${slot} lv${prev.lv}→${cur.lv}: wDef ${prev.wDef}→${cur.wDef}, mDef ${prev.mDef}→${cur.mDef}`,
        ).toBe(true);
        // Both should be non-decreasing.
        expect(cur.wDef).toBeGreaterThanOrEqual(prev.wDef);
        expect(cur.mDef).toBeGreaterThanOrEqual(prev.mDef);
      }
    });
  }
});

describe("armor catalog — ids are namespaced correctly", () => {
  const SLOT_PREFIXES: Record<string, string> = {
    [EquipSlot.HAT]: "hat.",
    [EquipSlot.TOP]: "top.",
    [EquipSlot.BOTTOM]: "bottom.",
    [EquipSlot.SHOES]: "shoes.",
    [EquipSlot.GLOVES]: "gloves.",
    [EquipSlot.CAPE]: "cape.",
    [EquipSlot.SHIELD]: "shield.",
    [EquipSlot.OVERALL]: "overall.",
    [EquipSlot.RING]: "ring.",
    [EquipSlot.EARRING]: "earring.",
    [EquipSlot.PENDANT]: "pendant.",
    [EquipSlot.BELT]: "belt.",
    [EquipSlot.FACE_ACCESSORY]: "face.",
    [EquipSlot.EYE_ACCESSORY]: "eye.",
    [EquipSlot.SHOULDER]: "shoulder.",
    [EquipSlot.MEDAL]: "medal.",
    [EquipSlot.BADGE]: "badge.",
    [EquipSlot.POCKET]: "pocket.",
  };

  for (const slot of ARMOR_SLOTS) {
    const prefix = SLOT_PREFIXES[slot]!;
    const items = armorForSlot(slot);

    it(`${slot} items use "${prefix}" prefix`, () => {
      for (const item of items) {
        expect(item.id).toMatch(new RegExp(`^${prefix}`));
      }
    });
  }
});

describe("armor catalog — class-flavored items have classReq", () => {
  // Every non-weapon item with a classReq must use a valid ClassArchetype.
  const validArchetypes = new Set(["BEGINNER", "WARRIOR", "MAGE", "ARCHER", "THIEF", "PIRATE"]);

  const classFlavored = Object.values(ITEMS).filter(
    (i) => i.slot !== EquipSlot.WEAPON && i.classReq,
  );

  it("class-flavored armor entries exist", () => {
    expect(classFlavored.length).toBeGreaterThanOrEqual(1);
  });

  for (const item of classFlavored) {
    it(`${item.id} has valid classReq archetypes`, () => {
      for (const arch of item.classReq!) {
        expect(validArchetypes.has(arch)).toBe(true);
      }
    });
  }
});

describe("armor catalog — no zero-stat or placeholder items", () => {
  const ALL_ARMOR = Object.values(ITEMS).filter(
    (i) => i.slot !== EquipSlot.WEAPON && i.slot !== EquipSlot.CHAIR,
  );

  it("every armor item has baseStatBonus > 0", () => {
    for (const item of ALL_ARMOR) {
      expect(item.baseStatBonus, `${item.id} has baseStatBonus 0`).toBeGreaterThan(0);
    }
  });

  it("every armor item has a non-empty name", () => {
    for (const item of ALL_ARMOR) {
      expect(item.name.length, `${item.id} has empty name`).toBeGreaterThan(0);
    }
  });

  it("no armor item has baseAttack > 0 (defense items only)", () => {
    for (const item of ALL_ARMOR) {
      // Exception: gloves may have small baseAttack for melee classes.
      if (item.slot !== EquipSlot.GLOVES) {
        expect(item.baseAttack, `${item.id} has baseAttack > 0`).toBe(0);
      }
    }
  });

  it("all primaryStat values are valid", () => {
    const valid = new Set(["STR", "DEX", "INT", "LUK"]);
    for (const item of ALL_ARMOR) {
      expect(
        valid.has(item.primaryStat),
        `${item.id} has invalid primaryStat ${item.primaryStat}`,
      ).toBe(true);
    }
  });
});

describe("armor catalog — unique IDs across entire catalog", () => {
  it("has no duplicate item IDs", () => {
    const ids = Object.keys(ITEMS);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("armor catalog — every slot has level band coverage", () => {
  // Core armor slots should have items at multiple level bands.
  const CORE_SLOTS = [
    EquipSlot.HAT,
    EquipSlot.TOP,
    EquipSlot.BOTTOM,
    EquipSlot.SHOES,
    EquipSlot.GLOVES,
    EquipSlot.CAPE,
    EquipSlot.SHIELD,
    EquipSlot.OVERALL,
  ];

  for (const slot of CORE_SLOTS) {
    it(`${slot} has items at levels 5, 10, 20, 30, 40, 50, 60`, () => {
      const items = armorForSlot(slot);
      const levels = new Set(items.map((i) => i.levelReq));
      const expected = [5, 10, 20, 30, 40, 50, 60];
      for (const lv of expected) {
        expect(levels.has(lv), `${slot} missing level ${lv} item`).toBe(true);
      }
    });
  }
});

describe("armor catalog — shield is warrior-only", () => {
  const shields = armorForSlot(EquipSlot.SHIELD);

  it("all shields have classReq including WARRIOR", () => {
    for (const item of shields) {
      expect(item.classReq).toBeDefined();
      expect(item.classReq).toContain(ClassArchetype.WARRIOR);
    }
  });
});
