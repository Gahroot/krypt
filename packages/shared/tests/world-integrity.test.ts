/**
 * World data integrity — validates all map, NPC, shop, and quest definitions for internal consistency.
 */
import { describe, it, expect } from "vitest";
import { MAPS } from "../src/world.js";
import { getMobDef } from "../src/mobs.js";
import { NPCS } from "../src/npcs.js";
import { QUESTS } from "../src/quests.js";

const MAP_LIST = Object.values(MAPS);

describe("World integrity", () => {
  it("has at least 5 maps defined", () => {
    expect(MAP_LIST.length).toBeGreaterThanOrEqual(5);
  });

  for (const map of MAP_LIST) {
    describe(map.id, () => {
      it("has at least 1 foothold", () => {
        expect(map.footholds.length).toBeGreaterThanOrEqual(1);
      });

      it("has a playerSpawn with valid coordinates", () => {
        expect(map.playerSpawn).toBeDefined();
        expect(typeof map.playerSpawn.x).toBe("number");
        expect(typeof map.playerSpawn.y).toBe("number");
      });

      it("has positive width and height", () => {
        expect(map.width).toBeGreaterThan(0);
        expect(map.height).toBeGreaterThan(0);
      });

      it("no duplicate foothold IDs", () => {
        const ids = map.footholds.map((f) => f.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("every portal references a valid toMapId", () => {
        const validMapIds = new Set(MAP_LIST.map((m) => m.id));
        for (const portal of map.portals) {
          expect(validMapIds.has(portal.toMapId)).toBe(true);
        }
      });

      it("every mob spawn references a valid footholdId", () => {
        const footholdIds = new Set(map.footholds.map((f) => f.id));
        for (const spawn of map.spawns) {
          expect(footholdIds.has(spawn.footholdId)).toBe(true);
        }
      });

      it("every mob spawn references a valid mobId", () => {
        for (const spawn of map.spawns) {
          expect(getMobDef(spawn.mobId)).toBeDefined();
        }
      });

      it("ladders have distinct yTop and yBottom", () => {
        for (const ladder of map.ladders) {
          expect(ladder.yTop).not.toBe(ladder.yBottom);
        }
      });

      it("ladder x is within map bounds", () => {
        for (const ladder of map.ladders) {
          expect(ladder.x).toBeGreaterThanOrEqual(0);
          expect(ladder.x).toBeLessThanOrEqual(map.width);
        }
      });
    });
  }
});

describe("NPC integrity", () => {
  it("every NPC has at least 1 dialog node", () => {
    for (const npc of Object.values(NPCS)) {
      expect(npc.dialog.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("all dialog 'next' references are valid indices", () => {
    for (const npc of Object.values(NPCS)) {
      for (const node of npc.dialog) {
        if (node.kind === "line" && node.next !== undefined) {
          expect(node.next).toBeGreaterThanOrEqual(0);
          expect(node.next).toBeLessThan(npc.dialog.length);
        }
      }
    }
  });

  it("all branch dialog nodes have non-empty choices", () => {
    for (const npc of Object.values(NPCS)) {
      for (const node of npc.dialog) {
        if (node.kind === "branch") {
          expect(node.choices.length).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe("Quest integrity", () => {
  it("every quest has at least 1 objective", () => {
    for (const quest of Object.values(QUESTS)) {
      expect(quest.objectives.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every quest has rewards", () => {
    for (const quest of Object.values(QUESTS)) {
      expect(quest.rewards).toBeDefined();
    }
  });

  it("every kill objective references a valid mobId", () => {
    for (const quest of Object.values(QUESTS)) {
      for (const obj of quest.objectives) {
        if (obj.kind === "kill") {
          expect(getMobDef(obj.mobId)).toBeDefined();
        }
      }
    }
  });
});
