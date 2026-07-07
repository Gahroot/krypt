/**
 * Quest integrity tests — asserts every quest reference resolves to a real
 * NPC, mob, or item in the game catalog.
 *
 *  1. Every quest's giverNpcId resolves in NPCS.
 *  2. Every kill objective's mobId resolves in MOBS.
 *  3. Every collect objective's itemId resolves in ITEMS or ETC_ITEMS.
 *  4. Every talk objective's npcId resolves in NPCS.
 *  5. Every reward item resolves in ITEMS or MOUNTS.
 *  6. Every prereqQuestId resolves to a real quest id.
 */

import { describe, it, expect } from "vitest";
import { QUESTS } from "../src/quests.js";
import { NPCS } from "../src/npcs.js";
import { MOBS } from "../src/mobs.js";
import { ITEMS, ETC_ITEMS } from "../src/items.js";
import { MOUNTS } from "../src/mounts.js";

describe("Quest giver NPC resolution", () => {
  for (const quest of Object.values(QUESTS)) {
    it(`"${quest.id}" giverNpcId "${quest.giverNpcId}" resolves in NPCS`, () => {
      expect(NPCS[quest.giverNpcId]).toBeDefined();
    });
  }
});

describe("Quest kill objective mob resolution", () => {
  for (const quest of Object.values(QUESTS)) {
    for (const obj of quest.objectives) {
      if (obj.kind === "kill") {
        it(`"${quest.id}" kill mobId "${obj.mobId}" resolves in MOBS`, () => {
          expect(MOBS[obj.mobId]).toBeDefined();
        });
      }
    }
  }
});

describe("Quest collect objective item resolution", () => {
  for (const quest of Object.values(QUESTS)) {
    for (const obj of quest.objectives) {
      if (obj.kind === "collect") {
        it(`"${quest.id}" collect itemId "${obj.itemId}" resolves in ITEMS or ETC_ITEMS`, () => {
          expect(ITEMS[obj.itemId] ?? ETC_ITEMS[obj.itemId]).toBeDefined();
        });
      }
    }
  }
});

describe("Quest talk objective NPC resolution", () => {
  for (const quest of Object.values(QUESTS)) {
    for (const obj of quest.objectives) {
      if (obj.kind === "talk") {
        it(`"${quest.id}" talk npcId "${obj.npcId}" resolves in NPCS`, () => {
          expect(NPCS[obj.npcId]).toBeDefined();
        });
      }
    }
  }
});

describe("Quest reward item resolution", () => {
  for (const quest of Object.values(QUESTS)) {
    if (quest.rewards.items) {
      for (const itemId of quest.rewards.items) {
        it(`"${quest.id}" reward itemId "${itemId}" resolves in ITEMS or MOUNTS`, () => {
          expect(ITEMS[itemId] ?? MOUNTS[itemId]).toBeDefined();
        });
      }
    }
  }
});

describe("Quest prereq chain resolution", () => {
  for (const quest of Object.values(QUESTS)) {
    if (quest.prereqQuestId) {
      it(`"${quest.id}" prereqQuestId "${quest.prereqQuestId}" resolves to a real quest`, () => {
        expect(QUESTS[quest.prereqQuestId!]).toBeDefined();
      });
    }
  }
});

describe("No quest prereq self-references", () => {
  for (const quest of Object.values(QUESTS)) {
    if (quest.prereqQuestId) {
      it(`"${quest.id}" does not reference itself as prereq`, () => {
        expect(quest.prereqQuestId).not.toBe(quest.id);
      });
    }
  }
});

describe("No duplicate quest ids", () => {
  const ids = Object.keys(QUESTS);
  it("has no duplicate quest ids", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });
});
