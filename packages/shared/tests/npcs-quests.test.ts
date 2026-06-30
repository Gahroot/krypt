import { describe, it, expect } from "vitest";
import { NPCS, getNpcsForMap } from "../src/npcs.js";
import { QUESTS } from "../src/quests.js";
import { ITEMS } from "../src/items.js";
import { MOBS } from "../src/mobs.js";

describe("NPC catalog", () => {
  it("every NPC has a unique id matching its key in NPCS", () => {
    for (const [key, npc] of Object.entries(NPCS)) {
      expect(npc.id).toBe(key);
    }
  });

  it("getNpcsForMap returns only NPCs on that map", () => {
    const dawnNpcs = getNpcsForMap("dawn_isle");
    expect(dawnNpcs.length).toBeGreaterThan(0);
    for (const npc of dawnNpcs) {
      expect(npc.mapId).toBe("dawn_isle");
    }

    const empty = getNpcsForMap("nonexistent_map");
    expect(empty).toEqual([]);
  });

  it("every NPC's mapId resolves to a known map", () => {
    // Import MAPS lazily to avoid circular concerns — just check the id strings.
    const knownMapIds = new Set([
      "dawn_isle",
      "heartland_harbor",
      "meadowfield",
      "craghold",
      "sylvanreach",
      "dusk_ward",
      "dusk_ward_subway",
      "crossway",
      "mirefen",
      "skyhaven",
      "frosthold",
      "tideways",
      "drakemoor",
    ]);
    for (const npc of Object.values(NPCS)) {
      expect(knownMapIds.has(npc.mapId)).toBe(true);
    }
  });
});

describe("quest catalog integrity", () => {
  it("every quest's giverNpcId resolves to an NPC in NPCS", () => {
    for (const [key, quest] of Object.entries(QUESTS)) {
      expect(
        NPCS[quest.giverNpcId],
        `quest "${key}" has unknown giverNpcId "${quest.giverNpcId}"`,
      ).toBeDefined();
    }
  });

  it("every quest reward item id resolves to an item in ITEMS", () => {
    for (const [key, quest] of Object.entries(QUESTS)) {
      for (const itemId of quest.rewards.items ?? []) {
        expect(ITEMS[itemId], `quest "${key}" rewards unknown item "${itemId}"`).toBeDefined();
      }
    }
  });

  it("every quest kill objective references a known mob", () => {
    for (const [key, quest] of Object.entries(QUESTS)) {
      for (const obj of quest.objectives) {
        if (obj.kind === "kill") {
          expect(MOBS[obj.mobId], `quest "${key}" kills unknown mob "${obj.mobId}"`).toBeDefined();
        }
      }
    }
  });

  it("every quest talk objective references a known NPC", () => {
    for (const [key, quest] of Object.entries(QUESTS)) {
      for (const obj of quest.objectives) {
        if (obj.kind === "talk") {
          expect(
            NPCS[obj.npcId],
            `quest "${key}" talks to unknown NPC "${obj.npcId}"`,
          ).toBeDefined();
        }
      }
    }
  });
});
