import { describe, it, expect } from "vitest";
import { ClassArchetype, CLASSES } from "../src/classes.js";
import { ITEMS, WeaponType } from "../src/items.js";

const NON_BEGINNER_ARCHETYPES = [
  ClassArchetype.WARRIOR,
  ClassArchetype.MAGE,
  ClassArchetype.ARCHER,
  ClassArchetype.THIEF,
  ClassArchetype.PIRATE,
];

describe("class skills", () => {
  for (const archetype of NON_BEGINNER_ARCHETYPES) {
    it(`${archetype} has at least one tier-1 active skill`, () => {
      const cls = CLASSES[archetype];
      const tier1 = cls.jobTiers.find((t) => t.tier === 1);
      expect(tier1).toBeDefined();
      const actives = tier1!.skills.filter((s) => s.kind === "active");
      expect(actives.length).toBeGreaterThanOrEqual(1);
    });

    it(`${archetype} has at least one tier-1 passive skill`, () => {
      const cls = CLASSES[archetype];
      const tier1 = cls.jobTiers.find((t) => t.tier === 1);
      expect(tier1).toBeDefined();
      const passives = tier1!.skills.filter((s) => s.kind === "passive");
      expect(passives.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("weapon classReq validity", () => {
  const allArchetypes = new Set(Object.values(ClassArchetype));

  for (const [id, item] of Object.entries(ITEMS)) {
    if (item.slot !== "WEAPON") continue;

    it(`${id} classReq archetypes are all valid`, () => {
      if (item.classReq) {
        for (const arch of item.classReq) {
          expect(allArchetypes.has(arch)).toBe(true);
        }
      }
    });

    if (item.weaponType !== undefined) {
      it(`${id} has weaponType ${item.weaponType}`, () => {
        expect(Object.values(WeaponType)).toContain(item.weaponType);
      });
    }
  }
});
