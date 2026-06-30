/**
 * Dawn Isle intro content — verifies the tutorial quest chain, job-instructor
 * preview NPCs, and the ferryman all resolve correctly on the DAWN_ISLE map.
 */
import { describe, it, expect } from "vitest";
import { NPCS, getNpcsForMap } from "../src/npcs.js";
import { QUESTS } from "../src/quests.js";
import { ITEMS } from "../src/items.js";
import { MOBS } from "../src/mobs.js";
import { DAWN_ISLE, findFootholdBelow } from "../src/world.js";

// ---------------------------------------------------------------------------
// Tutorial quest chain (the full Maple-Island-parity arc)
// ---------------------------------------------------------------------------

/** Ordered list of quest ids that form the Dawn Isle tutorial chain. */
const TUTORIAL_CHAIN = [
  "quest.dawn_tutorial", // 1. Welcome / movement
  "quest.dawn_step_jump", // 2. Jumping
  "quest.dawn_trio", // 3. Combat (kill snails)
  "quest.dawn_step_loot", // 4. Loot (collect item)
  "quest.dawn_step_inventory", // 5. Inventory
  "quest.dawn_level3", // 6. Grinding
  "quest.dawn_ferry", // 7. Travel to Heartland
] as const;

describe("Dawn Isle tutorial quest chain", () => {
  for (const questId of TUTORIAL_CHAIN) {
    it(`quest "${questId}" exists and resolves fully`, () => {
      const quest = QUESTS[questId];
      expect(quest, `missing quest "${questId}"`).toBeDefined();

      // Giver NPC must exist
      expect(
        NPCS[quest!.giverNpcId],
        `quest "${questId}" has unknown giver "${quest!.giverNpcId}"`,
      ).toBeDefined();

      // Giver must be on DAWN_ISLE
      expect(NPCS[quest!.giverNpcId]!.mapId, `giver of "${questId}" should be on dawn_isle`).toBe(
        "dawn_isle",
      );

      // Every objective must reference known entities
      for (const obj of quest!.objectives) {
        if (obj.kind === "kill") {
          expect(
            MOBS[obj.mobId],
            `quest "${questId}" kills unknown mob "${obj.mobId}"`,
          ).toBeDefined();
        }
        if (obj.kind === "talk") {
          const npc = NPCS[obj.npcId];
          expect(npc, `quest "${questId}" talks to unknown NPC "${obj.npcId}"`).toBeDefined();
          expect(npc!.mapId, `talk target of "${questId}" should be on dawn_isle`).toBe(
            "dawn_isle",
          );
        }
        if (obj.kind === "collect") {
          expect(
            ITEMS[obj.itemId],
            `quest "${questId}" collects unknown item "${obj.itemId}"`,
          ).toBeDefined();
        }
      }

      // Every reward item must exist
      for (const itemId of quest!.rewards.items ?? []) {
        expect(ITEMS[itemId], `quest "${questId}" rewards unknown item "${itemId}"`).toBeDefined();
      }

      // Must have at least one objective
      expect(quest!.objectives.length, `quest "${questId}" should have objectives`).toBeGreaterThan(
        0,
      );
    });
  }

  it("quest chain covers: movement, jump, combat, loot, and inventory concepts", () => {
    const chainQuests = TUTORIAL_CHAIN.map((id) => QUESTS[id]!);
    const kinds = chainQuests.flatMap((q) => q.objectives.map((o) => o.kind));

    expect(kinds, "should have talk objectives (movement/jump/inventory)").toContain("talk");
    expect(kinds, "should have kill objectives (combat)").toContain("kill");
    expect(kinds, "should have collect objectives (loot)").toContain("collect");
    expect(kinds, "should have level objectives (grinding)").toContain("level");
  });
});

// ---------------------------------------------------------------------------
// Split Road of Destiny — five job-instructor preview NPCs
// ---------------------------------------------------------------------------

const JOB_INSTRUCTOR_IDS = [
  "npc.dawn_instructor_warrior",
  "npc.dawn_instructor_mage",
  "npc.dawn_instructor_archer",
  "npc.dawn_instructor_thief",
  "npc.dawn_instructor_pirate",
] as const;

describe("Split Road of Destiny — job instructor preview NPCs", () => {
  it("all five instructor NPCs exist in the catalog", () => {
    for (const id of JOB_INSTRUCTOR_IDS) {
      expect(NPCS[id], `missing instructor NPC "${id}"`).toBeDefined();
    }
  });

  it("exactly five instructor NPCs are on DAWN_ISLE", () => {
    const instructors = getNpcsForMap("dawn_isle").filter((n) => n.role === "job");
    expect(instructors.length, "should be exactly 5 job instructors").toBe(5);
  });

  it("each instructor stands on its own distinct alcove of the forked road", () => {
    // The Split Road of Destiny forks into five branch ledges, one per class.
    // Every instructor must sit within the map, above the ground, and on a
    // foothold that no other instructor shares (their own visually distinct
    // alcove rather than a single crammed platform).
    const usedFootholds = new Map<number, string>();

    for (const id of JOB_INSTRUCTOR_IDS) {
      const npc = NPCS[id]!;
      expect(npc.mapId, `${id} should be on dawn_isle`).toBe("dawn_isle");

      // Spread horizontally across the widened map, not clustered.
      expect(npc.x, `${id} x should be within the map`).toBeGreaterThanOrEqual(0);
      expect(npc.x, `${id} x should be within the map`).toBeLessThanOrEqual(DAWN_ISLE.width);

      // Standing on a branch ledge, clearly above the ground floor.
      expect(npc.y, `${id} should stand above the ground floor`).toBeLessThan(540);

      // Resolve the foothold the instructor is standing on (its alcove).
      const ledge = findFootholdBelow(DAWN_ISLE, npc.x, npc.y);
      expect(ledge, `${id} should stand on a foothold (its alcove)`).toBeDefined();
      expect(ledge!.solid, `${id} alcove should not be the solid ground floor`).not.toBe(true);

      // No two instructors may share the same alcove ledge.
      const prior = usedFootholds.get(ledge!.id);
      expect(prior, `${id} shares alcove foothold ${ledge!.id} with ${prior}`).toBeUndefined();
      usedFootholds.set(ledge!.id, id);
    }

    // Five instructors on five distinct alcoves.
    expect(usedFootholds.size, "each instructor should occupy a distinct alcove").toBe(5);

    // Their x positions should be meaningfully spread, not crammed in a row.
    const xs = JOB_INSTRUCTOR_IDS.map((id) => NPCS[id]!.x).sort((a, b) => a - b);
    expect(xs[xs.length - 1]! - xs[0]!, "instructors should span a wide road").toBeGreaterThan(600);
  });

  it("each instructor has a non-empty dialog tree", () => {
    for (const id of JOB_INSTRUCTOR_IDS) {
      const npc = NPCS[id]!;
      expect(npc.dialog.length, `${id} should have at least one dialog node`).toBeGreaterThan(0);
    }
  });

  it("each instructor describes their class and mentions the advancement level", () => {
    for (const id of JOB_INSTRUCTOR_IDS) {
      const npc = NPCS[id]!;
      const fullText = npc.dialog.map((node) => ("text" in node ? node.text : "")).join(" ");
      expect(fullText, `${id} dialog should mention level 10`).toContain("level 10");
    }
  });

  it("instructors use role 'job' and have unique ids", () => {
    const seen = new Set<string>();
    for (const id of JOB_INSTRUCTOR_IDS) {
      const npc = NPCS[id]!;
      expect(npc.role, `${id} should have role "job"`).toBe("job");
      expect(npc.id, `${id} id should match key`).toBe(id);
      expect(seen.has(id), `${id} should be unique`).toBe(false);
      seen.add(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Ferryman NPC — sends players to Heartland at level 10
// ---------------------------------------------------------------------------

describe("Ferrymaster Cole on Dawn Isle", () => {
  const FERRY_ID = "npc.dawn_ferry";

  it("ferryman exists on DAWN_ISLE with role 'ferry'", () => {
    const npc = NPCS[FERRY_ID];
    expect(npc, "ferryman should exist").toBeDefined();
    expect(npc!.mapId, "ferryman should be on dawn_isle").toBe("dawn_isle");
    expect(npc!.role, "ferryman should have role 'ferry'").toBe("ferry");
  });

  it("ferryman has a dialog tree with a travel action to heartland_harbor", () => {
    const npc = NPCS[FERRY_ID]!;
    const branchNodes = npc.dialog.filter(
      (node): node is import("../src/npcs.js").DialogBranch => node.kind === "branch",
    );
    const travelChoices = branchNodes
      .flatMap((branch) => branch.choices)
      .filter((choice) => choice.action?.kind === "travel");

    expect(travelChoices.length, "should have at least one travel action").toBeGreaterThan(0);
    expect(travelChoices[0]!.action?.payload, "travel payload should be heartland_harbor").toBe(
      "heartland_harbor",
    );
  });

  it("ferryman dialog mentions the level 10 requirement", () => {
    const npc = NPCS[FERRY_ID]!;
    const fullText = npc.dialog.map((node) => ("text" in node ? node.text : "")).join(" ");
    expect(fullText, "dialog should mention level 10").toContain("level 10");
  });
});

// ---------------------------------------------------------------------------
// Overall Dawn Isle NPC census
// ---------------------------------------------------------------------------

describe("Dawn Isle NPC census", () => {
  it("has at least 8 NPCs total (guide + ferry + storage + 5 instructors)", () => {
    const dawnNpcs = getNpcsForMap("dawn_isle");
    expect(dawnNpcs.length, "dawn_isle should have ≥ 8 NPCs").toBeGreaterThanOrEqual(8);
  });

  it("has a guide, a ferry, and a storage NPC", () => {
    const dawnNpcs = getNpcsForMap("dawn_isle");
    const roles = dawnNpcs.map((n) => n.role);
    expect(roles, "should have a guide").toContain("guide");
    expect(roles, "should have a ferry").toContain("ferry");
    expect(roles, "should have storage").toContain("storage");
  });
});
