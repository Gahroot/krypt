import { describe, it, expect } from "vitest";
import { ITEMS, EquipSlot } from "../src/items.js";

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
