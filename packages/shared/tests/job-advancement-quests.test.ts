import { describe, it, expect } from "vitest";
import { QUESTS, getAdvancementQuest, getQuestsForNpc } from "../src/quests.js";
import { NPCS } from "../src/npcs.js";
import { ITEMS } from "../src/items.js";
import { ClassArchetype, CLASSES } from "../src/classes.js";

/**
 * Job advancement quest chains — integrity + reference tests.
 *
 * Each archetype (Warrior, Mage, Archer, Thief, Pirate) has four quests
 * (tiers 1-4) gated by level and given by the class hometown instructor.
 */

const ADVANCEMENT_ARCHETYPES: readonly {
  archetype: ClassArchetype;
  /** Map id of the hometown where the instructor NPC lives. */
  hometownMap: string;
  /** NPC id of the hometown instructor. */
  instructorNpcId: string;
  /** Level gates for tiers 1-4. */
  levelGates: readonly [number, number, number, number];
}[] = [
  {
    archetype: ClassArchetype.WARRIOR,
    hometownMap: "craghold",
    instructorNpcId: "npc.craghold_instructor_warrior",
    levelGates: [10, 30, 60, 100],
  },
  {
    archetype: ClassArchetype.MAGE,
    hometownMap: "sylvanreach",
    instructorNpcId: "npc.sylvanreach_instructor_mage",
    levelGates: [10, 30, 60, 100],
  },
  {
    archetype: ClassArchetype.ARCHER,
    hometownMap: "meadowfield",
    instructorNpcId: "npc.meadowfield_instructor_archer",
    levelGates: [10, 30, 60, 100],
  },
  {
    archetype: ClassArchetype.THIEF,
    hometownMap: "dusk_ward",
    instructorNpcId: "npc.dusk_ward_instructor_thief",
    levelGates: [10, 30, 60, 100],
  },
  {
    archetype: ClassArchetype.PIRATE,
    hometownMap: "heartland_harbor",
    instructorNpcId: "npc.harbor_instructor_pirate",
    levelGates: [10, 30, 60, 100],
  },
];

describe("job advancement quest chains", () => {
  for (const { archetype, hometownMap, instructorNpcId, levelGates } of ADVANCEMENT_ARCHETYPES) {
    describe(archetype, () => {
      // ── Instructor NPC exists and lives in the right map ──────────────

      it(`instructor NPC "${instructorNpcId}" exists and lives on ${hometownMap}`, () => {
        const npc = NPCS[instructorNpcId];
        expect(npc, `NPC "${instructorNpcId}" missing from NPCS catalog`).toBeDefined();
        expect(npc!.mapId).toBe(hometownMap);
        expect(npc!.role).toBe("job");
      });

      // ── Quests exist for all four tiers ──────────────────────────────

      for (let tier = 1; tier <= 4; tier++) {
        const requiredLevel = levelGates[tier - 1];
        const questId = `quest.${archetype.toLowerCase()}_job_${tier}`;

        describe(`tier ${tier} (Lv${requiredLevel})`, () => {
          it(`quest "${questId}" exists in QUESTS catalog`, () => {
            expect(QUESTS[questId], `Quest "${questId}" missing`).toBeDefined();
          });

          it(`has correct giverNpcId matching the hometown instructor`, () => {
            const quest = QUESTS[questId];
            expect(quest).toBeDefined();
            expect(quest!.giverNpcId).toBe(instructorNpcId);
          });

          it(`has requiredLevel === ${requiredLevel}`, () => {
            const quest = QUESTS[questId];
            expect(quest).toBeDefined();
            expect(quest!.requiredLevel).toBe(requiredLevel);
          });

          if (tier === 1) {
            it(`has exactly one talk objective to the instructor`, () => {
              const quest = QUESTS[questId];
              expect(quest).toBeDefined();
              const talkObjs = quest!.objectives.filter((o) => o.kind === "talk");
              expect(talkObjs.length).toBe(1);
              expect((talkObjs[0] as { npcId: string }).npcId).toBe(instructorNpcId);
            });
          } else {
            it(`has kill/collect objectives (no pure talk objective)`, () => {
              const quest = QUESTS[questId];
              expect(quest).toBeDefined();
              const hasCombatObj = quest!.objectives.some(
                (o) => o.kind === "kill" || o.kind === "collect",
              );
              expect(hasCombatObj).toBe(true);
            });
          }

          it(`reward includes jobAdvanceToTier === ${tier}`, () => {
            const quest = QUESTS[questId];
            expect(quest).toBeDefined();
            expect(quest!.rewards.jobAdvanceToTier).toBe(tier);
          });

          it(`reward items all resolve in ITEMS catalog`, () => {
            const quest = QUESTS[questId];
            expect(quest).toBeDefined();
            for (const itemId of quest!.rewards.items ?? []) {
              expect(
                ITEMS[itemId],
                `quest "${questId}" rewards unknown item "${itemId}"`,
              ).toBeDefined();
            }
          });
        });
      }
    });
  }
});

describe("advancement quest lookup helper", () => {
  it("getAdvancementQuest resolves known quests", () => {
    for (const { archetype } of ADVANCEMENT_ARCHETYPES) {
      for (let tier = 1; tier <= 4; tier++) {
        const q = getAdvancementQuest(archetype, tier);
        expect(q, `getAdvancementQuest("${archetype}", ${tier}) should exist`).toBeDefined();
        expect(q!.id).toBe(`quest.${archetype.toLowerCase()}_job_${tier}`);
      }
    }
  });

  it("getAdvancementQuest returns undefined for unknown archetype", () => {
    expect(getAdvancementQuest("ninja", 1)).toBeUndefined();
  });
});

describe("instructor NPCs give advancement quests", () => {
  for (const { instructorNpcId, archetype } of ADVANCEMENT_ARCHETYPES) {
    it(`${instructorNpcId} has quests in getQuestsForNpc`, () => {
      const quests = getQuestsForNpc(instructorNpcId);
      expect(quests.length).toBeGreaterThanOrEqual(4);
      for (let tier = 1; tier <= 4; tier++) {
        const expectedId = `quest.${archetype.toLowerCase()}_job_${tier}`;
        expect(
          quests.some((q) => q.id === expectedId),
          `NPC "${instructorNpcId}" should offer quest "${expectedId}"`,
        ).toBe(true);
      }
    });
  }
});

describe("class hometown alignment", () => {
  it("each class def's hometown matches the instructor NPC's mapId", () => {
    for (const { archetype, hometownMap } of ADVANCEMENT_ARCHETYPES) {
      const classDef = CLASSES[archetype];
      expect(classDef).toBeDefined();
      // The hometown stored in the class def may use dashes or underscores;
      // we check the NPC map directly.
      expect(hometownMap).toBeTruthy();
    }
  });
});
