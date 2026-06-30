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

    it(`${wt} has 4–7 tiers across level bands`, () => {
      expect(entries.length).toBeGreaterThanOrEqual(4);
      expect(entries.length).toBeLessThanOrEqual(7);
    });
  }
});

describe("weapon catalog — coverage", () => {
  const coveredTypes = new Set(WEAPONS.map(([, item]) => item.weaponType));

  for (const wt of ALL_WEAPON_TYPES) {
    it(`has at least one weapon of type ${wt}`, () => {
      expect(coveredTypes.has(wt)).toBe(true);
    });
  }

  it("has at least 40 weapons total", () => {
    expect(WEAPONS.length).toBeGreaterThanOrEqual(40);
  });
});
