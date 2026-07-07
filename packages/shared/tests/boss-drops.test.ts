import { describe, it, expect } from "vitest";
import { MOBS, rollItemDrops } from "../src/mobs.js";
import { ITEMS } from "../src/items.js";
import { PotentialTier } from "../src/rarity.js";

// ── Boss mob ids that live in dungeon / field-boss / raid spawn zones ──
const BOSS_IDS = [
  // Dungeon bosses
  "mob.bogmaw", // Mirefen Ruins
  "mob.subway_curse_eye", // Dusk Ward Subway PQ
  "mob.glacial_abomination", // Frosthold Icecave
  // Field bosses
  "mob.glacius_prime", // Frosthold Slopes
  "mob.tempest_lord", // Skyhaven Driftpeaks
  "mob.kraken", // Tideways Abyss
  // Heartland field bosses
  "mob.tidemaw",
  "mob.rotwood",
  "mob.gelatinarch",
  "mob.sporemother",
  "mob.void_wisp",
  // Raid boss
  "mob.pyroclasm", // Drakemoor
] as const;

describe("boss tier", () => {
  for (const bossId of BOSS_IDS) {
    const mob = MOBS[bossId];
    if (!mob) throw new Error(`Missing boss mob: ${bossId}`);

    describe(bossId, () => {
      it("is flagged as a boss with combat stats", () => {
        expect(mob.isBoss).toBe(true);
        expect(typeof mob.attackDamage).toBe("number");
        expect(mob.attackDamage).toBeGreaterThan(0);
        expect(typeof mob.attackCooldownMs).toBe("number");
        expect(mob.attackCooldownMs).toBeGreaterThan(0);
      });

      it("has a non-empty drop table", () => {
        expect(mob.dropTable.length).toBeGreaterThan(0);
      });

      it("every drop-table itemId resolves to a real item in the catalog", () => {
        for (const entry of mob.dropTable) {
          expect(ITEMS[entry.itemId], `Unknown item: ${entry.itemId}`).toBeDefined();
        }
      });

      it("weapon drops are flagged legendaryEligible", () => {
        const weaponDrops = mob.dropTable.filter((e) => e.itemId.startsWith("wpn."));
        expect(weaponDrops.length).toBeGreaterThan(0);
        for (const entry of weaponDrops) {
          expect(entry.legendaryEligible, `${entry.itemId} should be legendaryEligible`).toBe(true);
        }
      });

      it("armor drops carry a minPotentialTier of EPIC or higher", () => {
        const armorDrops = mob.dropTable.filter((e) => !e.itemId.startsWith("wpn."));
        expect(armorDrops.length).toBeGreaterThan(0);
        for (const entry of armorDrops) {
          expect(
            entry.minPotentialTier,
            `${entry.itemId} should have minPotentialTier`,
          ).toBeDefined();
          expect(
            [PotentialTier.EPIC, PotentialTier.UNIQUE, PotentialTier.LEGENDARY].includes(
              entry.minPotentialTier!,
            ),
            `${entry.itemId} minPotentialTier should be EPIC+`,
          ).toBe(true);
        }
      });
    });
  }
});

describe("rollItemDrops on bosses", () => {
  const bogmaw = MOBS["mob.bogmaw"]!;
  const pyroclasm = MOBS["mob.pyroclasm"]!;

  it("drops every entry when rng=0 (all chances pass)", () => {
    const drops = rollItemDrops(bogmaw, () => 0);
    expect(drops).toEqual(bogmaw.dropTable.map((e) => e.itemId));
  });

  it("drops nothing when rng→1", () => {
    expect(rollItemDrops(bogmaw, () => 0.99999)).toEqual([]);
  });

  it("drops resolve to real ITEMS catalog entries", () => {
    // Force every drop to land
    const drops = rollItemDrops(bogmaw, () => 0);
    for (const itemId of drops) {
      expect(ITEMS[itemId], `Drop "${itemId}" not in ITEMS catalog`).toBeDefined();
    }
  });

  it("each boss's full drop table maps to real item ids", () => {
    for (const bossId of BOSS_IDS) {
      const mob = MOBS[bossId]!;
      for (const entry of mob.dropTable) {
        expect(ITEMS[entry.itemId], `Boss ${bossId}: unknown item "${entry.itemId}"`).toBeDefined();
      }
    }
  });
});
