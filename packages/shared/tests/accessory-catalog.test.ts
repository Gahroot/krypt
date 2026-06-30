import { describe, it, expect } from "vitest";
import { ITEMS, EquipSlot } from "../src/items.js";

/** All accessory slots added for MapleStory parity. */
const ACCESSORY_SLOTS: EquipSlot[] = [
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

/** Items belonging to a given slot, sorted by levelReq. */
function itemsForSlot(slot: EquipSlot) {
  return Object.values(ITEMS)
    .filter((i) => i.slot === slot)
    .sort((a, b) => a.levelReq - b.levelReq);
}

// ── RING multi-slot note ───────────────────────────────────────────────
// In MapleStory a player can wear up to 4 rings simultaneously. The
// EquipSlot enum now includes RING_2 / RING_3 / RING_4 and the server
// resolveRingSlot() helper automatically assigns ring items to the first
// available ring slot.

describe("accessory catalog — every slot resolves", () => {
  for (const slot of ACCESSORY_SLOTS) {
    it(`${slot} has at least one item`, () => {
      const items = itemsForSlot(slot);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("accessory catalog — every item has a valid slot", () => {
  const validSlots = new Set(Object.values(EquipSlot));

  const accessories = Object.values(ITEMS).filter((i) => ACCESSORY_SLOTS.includes(i.slot));

  for (const item of accessories) {
    it(`${item.id} resolves to a known EquipSlot`, () => {
      expect(validSlots.has(item.slot)).toBe(true);
    });
  }
});

describe("accessory catalog — ids are namespaced correctly", () => {
  const SLOT_PREFIXES: Record<string, string> = {
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

  for (const slot of ACCESSORY_SLOTS) {
    const prefix = SLOT_PREFIXES[slot]!;
    const items = itemsForSlot(slot);

    it(`${slot} items use "${prefix}" prefix`, () => {
      for (const item of items) {
        expect(item.id).toMatch(new RegExp(`^${prefix}`));
      }
    });
  }
});

describe("accessory catalog — level bands ~10/30/50 per slot", () => {
  const EXPECTED_BANDS = [10, 30, 50, 60];

  for (const slot of ACCESSORY_SLOTS) {
    it(`${slot} has items at level bands ~10, ~30, ~50, ~60`, () => {
      const items = itemsForSlot(slot);
      const levels = new Set(items.map((i) => i.levelReq));
      for (const band of EXPECTED_BANDS) {
        expect(levels.has(band), `${slot} missing level ${band} band`).toBe(true);
      }
    });
  }
});

describe("accessory catalog — stats ascend across level bands", () => {
  for (const slot of ACCESSORY_SLOTS) {
    it(`${slot}: combined defence increases across bands`, () => {
      const items = itemsForSlot(slot);
      const levelBands = [...new Set(items.map((i) => i.levelReq))].sort((a, b) => a - b);

      const bandBest = levelBands.map((lv) => {
        const atLevel = items.filter((i) => i.levelReq === lv);
        return {
          lv,
          combinedDef: Math.max(...atLevel.map((i) => (i.wDef ?? 0) + (i.mDef ?? 0))),
        };
      });

      for (let i = 1; i < bandBest.length; i++) {
        const prev = bandBest[i - 1]!;
        const cur = bandBest[i]!;
        expect(
          cur.combinedDef > prev.combinedDef,
          `${slot} lv${prev.lv}→${cur.lv}: combinedDef ${prev.combinedDef}→${cur.combinedDef}`,
        ).toBe(true);
      }
    });
  }
});

describe("accessory catalog — no MapleStory IP names", () => {
  const forbidden = [
    /pendulum/i,
    /horntail/i,
    /zakum/i,
    /gollux/i,
    /mechanator/i,
    /deadeye/i,
    /crimsonheart/i,
    /magnus/i,
    /pinkbean/i,
    /cygnus/i,
  ];

  const accessories = Object.values(ITEMS).filter((i) => ACCESSORY_SLOTS.includes(i.slot));

  for (const item of accessories) {
    it(`${item.id} — "${item.name}" avoids MapleStory names`, () => {
      for (const pat of forbidden) {
        expect(item.name).not.toMatch(pat);
      }
    });
  }
});
