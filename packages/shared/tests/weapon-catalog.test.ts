import { describe, it, expect } from "vitest";
import { ITEMS, EquipSlot, WeaponType } from "../src/items.js";

const ALL_WEAPON_TYPES = Object.values(WeaponType);

/** All items in the catalog that are weapons. */
const WEAPONS = Object.entries(ITEMS).filter(([, item]) => item.slot === EquipSlot.WEAPON);

describe("weapon catalog — structural validity", () => {
  for (const [id, item] of WEAPONS) {
    it(`${id} has a valid weaponType`, () => {
      expect(ALL_WEAPON_TYPES).toContain(item.weaponType);
    });

    it(`${id} has baseAttack > 0`, () => {
      expect(item.baseAttack).toBeGreaterThan(0);
    });

    it(`${id} slot is WEAPON`, () => {
      expect(item.slot).toBe(EquipSlot.WEAPON);
    });
  }
});

describe("weapon catalog — ascending attack per type", () => {
  // Group weapons by weaponType, then sort each group by levelReq.
  const byType = new Map<WeaponType, { id: string; levelReq: number; baseAttack: number }[]>();

  for (const [id, item] of WEAPONS) {
    const wt = item.weaponType!;
    let group = byType.get(wt);
    if (!group) {
      group = [];
      byType.set(wt, group);
    }
    group.push({ id, levelReq: item.levelReq, baseAttack: item.baseAttack });
  }

  for (const [wt, entries] of byType) {
    it(`${wt} weapons have strictly ascending baseAttack by levelReq`, () => {
      const sorted = [...entries].sort((a, b) => a.levelReq - b.levelReq);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const curr = sorted[i]!;
        expect(curr.baseAttack).toBeGreaterThan(prev.baseAttack);
      }
    });

    it(`${wt} has 4–8 tiers across level bands`, () => {
      expect(entries.length).toBeGreaterThanOrEqual(4);
      expect(entries.length).toBeLessThanOrEqual(8);
    });
  }
});

describe("weapon catalog — no zero-stat or placeholder items", () => {
  for (const [id, item] of WEAPONS) {
    it(`${id} has baseStatBonus > 0`, () => {
      expect(item.baseStatBonus).toBeGreaterThan(0);
    });

    it(`${id} has a non-empty name`, () => {
      expect(item.name.length).toBeGreaterThan(0);
    });

    it(`${id} has a valid classReq`, () => {
      const validArchetypes = new Set(["BEGINNER", "WARRIOR", "MAGE", "ARCHER", "THIEF", "PIRATE"]);
      if (item.classReq) {
        for (const arch of item.classReq) {
          expect(validArchetypes.has(arch)).toBe(true);
        }
      }
    });
  }
});

describe("weapon catalog — unique IDs", () => {
  it("has no duplicate item IDs", () => {
    const ids = Object.keys(ITEMS);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("weapon catalog — coverage", () => {
  it("has at least 40 weapons total", () => {
    expect(WEAPONS.length).toBeGreaterThanOrEqual(40);
  });
});

describe("weapon catalog — type-level band coverage", () => {
  const EXPECTED_LEVELS = [10, 20, 30, 40, 50, 60];

  for (const wt of ALL_WEAPON_TYPES) {
    it(`${wt} has items covering levels 10–60`, () => {
      const typeWeapons = WEAPONS.filter(([, item]) => item.weaponType === wt);
      const levels = new Set(typeWeapons.map(([, item]) => item.levelReq));
      for (const lv of EXPECTED_LEVELS) {
        expect(levels.has(lv), `${wt} missing level ${lv} weapon`).toBe(true);
      }
    });
  }
});
