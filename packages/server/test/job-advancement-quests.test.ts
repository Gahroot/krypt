/**
 * Job advancement + quest chains — end-to-end test covering:
 *   1. 1st-job advancement for all 5 classes (Beginner → class) via NPC dialog
 *   2. 2nd-job advancement with branch choice for each class
 *   3. Skill-tree unlocks for the new tier + SP spending
 *   4. Persistence of branch choice
 *   5. Quest-driven advancement via jobAdvanceToTier reward field
 *
 * Run: npx tsx test/job-advancement-quests.test.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import {
  ClassArchetype,
  maxHpForLevel,
  maxMpForLevel,
  getClass,
  getBranch,
  QUESTS,
} from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[job-adv-quests] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function waitForNumeric(sdkRoom: any, msgType: number, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`message type ${msgType} was not called within ${timeoutMs}ms`));
    }, timeoutMs);
    sdkRoom.onMessage(msgType, (message: any) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

function waitForNamed(sdkRoom: any, name: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`message "${name}" was not called within ${timeoutMs}ms`));
    }, timeoutMs);
    sdkRoom.onMessage(name, (message: any) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

/** Sleep to suppress "map_npcs" on join. */
function suppressMapNpcs(sdkRoom: any) {
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress */
  });
}

let testCounter = 0;

/**
 * Create a character at a given archetype and level, then join the specified map.
 * Returns server room, sdk room, player ref, and charId.
 */
async function createAndJoin(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
  archetype: ClassArchetype,
  level: number,
  mapId: string,
  label: string,
) {
  const accountId = `jobadvq_test_${archetype}_${label}_${Date.now()}_${testCounter}`;
  const name = `QA${testCounter++}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const rec = accountStore.createCharacter(accountId, {
    name,
    archetype: ClassArchetype.BEGINNER,
    appearance: {
      gender: "M",
      skinId: "skin_0",
      hairId: "hair_0",
      hairColorId: "hc_0",
      faceId: "face_0",
      outfitId: "outfit_0",
    },
  });

  // Level up in the store.
  accountStore.updateCharacter(rec.charId, {
    level,
    exp: 0,
    ap: (level - 1) * 5,
    sp: (level - 1) * 3,
  });

  // If advancing past Beginner, pre-set archetype + tier + HP/MP.
  if (archetype !== ClassArchetype.BEGINNER) {
    accountStore.updateCharacter(rec.charId, {
      archetype,
      jobTier: 1,
      maxHp: maxHpForLevel(archetype, level),
      hp: maxHpForLevel(archetype, level),
      maxMp: maxMpForLevel(archetype, level),
      mp: maxMpForLevel(archetype, level),
    });
    // Also grant tier-1 skills.
    const cls = getClass(archetype);
    const tier1 = cls.jobTiers.find((t) => t.tier === 1);
    if (tier1) {
      const skillIds = tier1.skills.map((s) => s.id);
      accountStore.updateCharacter(rec.charId, { learnedSkills: skillIds });
    }
  }

  const serverRoom = await colyseus.createRoom(mapId, {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  suppressMapNpcs(sdkRoom);
  await sleep(250);

  const player = serverRoom.state.players.get(sdkRoom.sessionId);
  assert.ok(player, "player should exist after join");

  return { serverRoom, sdkRoom, player, charId: rec.charId, accountId };
}

// ─── Test Suite 1: 1st-job advancement for all 5 classes ────────────────────

/** Map from archetype to the NPC id used for 1st-job advancement in heartland_harbor. */
const JOB_NPC_ID = "npc.harbor_job";

/** Map from archetype to the dialog choice index for that class. */
const CLASS_CHOICE_INDEX: Record<string, number> = {
  WARRIOR: 0,
  MAGE: 1,
  ARCHER: 2,
  THIEF: 3,
  PIRATE: 4,
};

async function testFirstJobAdvancement(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
  archetype: ClassArchetype,
) {
  console.log(`[job-adv-quests] ── 1st job: Beginner → ${archetype} ──`);

  const { serverRoom, sdkRoom, player } = await createAndJoin(
    colyseus,
    ClassArchetype.BEGINNER,
    10,
    "heartland_harbor",
    `1st_${archetype}`,
  );

  // Position near Job Instructor.
  player.x = 450;
  player.y = 360;

  const expectedMaxHp = maxHpForLevel(archetype, 10);
  const expectedMaxMp = maxMpForLevel(archetype, 10);
  const tier1Skills = getClass(archetype).jobTiers[0]!.skills;

  // Walk through NPC dialog: line 1 → line 2 → branch node.
  const dp1 = waitForNumeric(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.TALK_NPC, { npcId: JOB_NPC_ID });
  await dp1;

  const dp2 = waitForNumeric(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  await dp2;

  const dp3 = waitForNumeric(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  const branch = await dp3;
  assert.ok(branch.choices, "should have choices");

  // Pick the right class.
  const choiceIdx = CLASS_CHOICE_INDEX[archetype]!;
  const advancePromise = waitForNumeric(sdkRoom, MessageType.JOB_ADVANCE, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: choiceIdx });
  const result = await advancePromise;

  assert.strictEqual(result.success, true, `${archetype} advancement should succeed`);
  assert.strictEqual(result.archetype, archetype, `archetype should be ${archetype}`);
  console.log(`[job-adv-quests] ✔ ${archetype} advancement: ${result.message}`);

  // Verify server state.
  assert.strictEqual(player.archetype, archetype);
  assert.strictEqual(player.maxHp, expectedMaxHp);
  assert.strictEqual(player.hp, expectedMaxHp);
  assert.strictEqual(player.maxMp, expectedMaxMp);
  assert.strictEqual(player.mp, expectedMaxMp);
  assert.strictEqual(player.jobTier, 1);

  // Verify tier-1 skills granted.
  for (const skill of tier1Skills) {
    assert.ok(
      player.learnedSkills.includes(skill.id),
      `tier-1 skill "${skill.id}" should be granted`,
    );
  }
  console.log(
    `[job-adv-quests] ✔ ${archetype} tier-1 skills: ${tier1Skills.map((s) => s.id).join(", ")}`,
  );

  await sdkRoom.leave();
}

// ─── Test Suite 2: 2nd-job advancement with branch choice ──────────────────

/** Map from archetype to hometown map id. */
const HOMETOWN_MAP: Record<string, string> = {
  WARRIOR: "craghold",
  MAGE: "sylvanreach",
  ARCHER: "meadowfield",
  THIEF: "dusk_ward",
  PIRATE: "heartland_harbor",
};

/** Map from archetype to class instructor NPC id. */
const INSTRUCTOR_NPC: Record<string, string> = {
  WARRIOR: "npc.craghold_instructor_warrior",
  MAGE: "npc.sylvanreach_instructor_mage",
  ARCHER: "npc.meadowfield_instructor_archer",
  THIEF: "npc.dusk_ward_instructor_thief",
  PIRATE: "npc.harbor_instructor_pirate",
};

/**
 * Test 2nd-job advancement for a given archetype with a specific branch.
 * Creates a level-30 character, sets the prerequisite quest as complete,
 * talks to the instructor, picks a branch, and verifies the result.
 */
async function testSecondJobAdvancement(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
  archetype: ClassArchetype,
  branchId: string,
) {
  console.log(`[job-adv-quests] ── 2nd job: ${archetype} → ${branchId} ──`);

  const mapId = HOMETOWN_MAP[archetype]!;
  const npcId = INSTRUCTOR_NPC[archetype]!;
  const branch = getBranch(archetype, branchId);
  assert.ok(branch, `branch "${branchId}" should exist for ${archetype}`);

  const { serverRoom, sdkRoom, player, charId } = await createAndJoin(
    colyseus,
    archetype,
    30,
    mapId,
    `2nd_${branchId}`,
  );

  // Mark prerequisite quest (quest.<archetype>_job_2) as "turnedIn" in player state.
  // Must be turnedIn (not just complete) so handleTalkNpc doesn't intercept with a quest turn-in offer.
  const prereqQuestId = `quest.${archetype.toLowerCase()}_job_2`;
  const prereqQuest = QUESTS[prereqQuestId];
  assert.ok(prereqQuest, `prereq quest ${prereqQuestId} should exist`);

  // Find or add the quest state and mark it turnedIn.
  const existingQs = player.questState.find((q) => q.questId === prereqQuestId);
  if (existingQs) {
    existingQs.status = "turnedIn";
    existingQs.objectiveProgress = existingQs.objectiveProgress.map((o) => ({
      ...o,
      current: o.target,
    }));
  } else {
    player.questState.push({
      questId: prereqQuestId,
      status: "turnedIn",
      objectiveProgress: prereqQuest.objectives.map((o) => ({
        kind: o.kind,
        current: o.kind === "kill" ? o.count : o.kind === "collect" ? o.count : 0,
        target:
          o.kind === "kill"
            ? o.count
            : o.kind === "collect"
              ? o.count
              : o.kind === "level"
                ? o.level
                : 0,
      })),
    });
  }

  // Position near the instructor.
  const instructorNpc = (await import("@maple/shared")).NPCS[npcId];
  if (instructorNpc) {
    player.x = instructorNpc.x + 10;
    player.y = instructorNpc.y;
  } else {
    player.x = 350;
    player.y = 360;
  }

  // Talk to the instructor — dialog should lead to advanceJob action.
  const dp1 = waitForNumeric(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.TALK_NPC, { npcId });
  await dp1;

  // Click Next to reach the branch node with "I'm ready to advance!".
  const dp2 = waitForNumeric(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  await dp2;

  // Click "I'm ready to advance!" (index 0) → triggers advanceJob → BRANCH_LIST.
  const advancePromise = waitForNumeric(sdkRoom, MessageType.BRANCH_LIST, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  const branchList = await advancePromise;

  assert.ok(branchList.branches, "should receive branch list");
  assert.ok(branchList.branches.length > 0, "should have at least one branch");
  console.log(
    `[job-adv-quests] ✔ branch list for ${archetype}:`,
    branchList.branches.map((b: any) => b.name).join(", "),
  );

  // Find the index of our target branch.
  const branchIdx = branchList.branches.findIndex((b: any) => b.id === branchId);
  assert.ok(branchIdx >= 0, `branch "${branchId}" should be in the list`);

  // Pick the branch.
  const jobAdvancePromise = waitForNumeric(sdkRoom, MessageType.JOB_ADVANCE, 3000);
  sdkRoom.send(MessageType.BRANCH_CHOICE, { branchId });
  const advanceResult = await jobAdvancePromise;

  assert.strictEqual(advanceResult.success, true, `${branchId} advancement should succeed`);
  assert.strictEqual(advanceResult.branchId, branchId, `branchId should be ${branchId}`);
  assert.strictEqual(advanceResult.jobTier, 2, "jobTier should be 2");
  console.log(`[job-adv-quests] ✔ ${archetype} → ${branch.name}: ${advanceResult.message}`);

  // Verify server state.
  assert.strictEqual(player.jobTier, 2, "player jobTier should be 2");
  assert.strictEqual(player.branchId, branchId, `player branchId should be ${branchId}`);

  // Verify HP/MP recomputed.
  const expectedMaxHp = maxHpForLevel(archetype, 30);
  const expectedMaxMp = maxMpForLevel(archetype, 30);
  assert.strictEqual(player.maxHp, expectedMaxHp, "maxHp recomputed");
  assert.strictEqual(player.hp, expectedMaxHp, "hp full heal");
  assert.strictEqual(player.maxMp, expectedMaxMp, "maxMp recomputed");
  assert.strictEqual(player.mp, expectedMaxMp, "mp full heal");

  // Verify tier-2 skills from the chosen branch are granted.
  const tier2 = branch.jobTiers.find((t) => t.tier === 2);
  if (tier2) {
    for (const skill of tier2.skills) {
      assert.ok(
        player.learnedSkills.includes(skill.id),
        `tier-2 skill "${skill.id}" should be granted`,
      );
    }
    console.log(
      `[job-adv-quests] ✔ ${branch.name} tier-2 skills: ${tier2.skills.map((s) => s.id).join(", ")}`,
    );
  }

  // Verify tier-1 skills still present.
  const tier1Skills = getClass(archetype).jobTiers[0]!.skills;
  for (const skill of tier1Skills) {
    assert.ok(
      player.learnedSkills.includes(skill.id),
      `tier-1 skill "${skill.id}" should still be present`,
    );
  }

  await sdkRoom.leave();
}

// ─── Test Suite 3: Quest-driven advancement via jobAdvanceToTier ───────────

async function testQuestDrivenAdvancement(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[job-adv-quests] ── quest-driven 1st job: Beginner → Warrior ──");

  const accountId = `questdrv_test_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `QD${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: {
      gender: "M",
      skinId: "skin_0",
      hairId: "hair_0",
      hairColorId: "hc_0",
      faceId: "face_0",
      outfitId: "outfit_0",
    },
  });
  accountStore.updateCharacter(rec.charId, { level: 10, exp: 0, ap: 45, sp: 27 });

  const serverRoom = await colyseus.createRoom("craghold", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  suppressMapNpcs(sdkRoom);
  await sleep(250);

  const player = serverRoom.state.players.get(sdkRoom.sessionId);
  assert.ok(player, "player exists");
  assert.strictEqual(player.archetype, ClassArchetype.BEGINNER, "starts as BEGINNER");

  // Manually mark the quest state as "complete" so we can turn it in.
  // ensureQuestStates already added it with status "available" on join.
  const qs = player.questState.find((q) => q.questId === "quest.warrior_job_1");
  assert.ok(qs, "quest.warrior_job_1 should be in questState after join");
  qs.status = "complete";
  qs.objectiveProgress = [{ kind: "talk", current: 1, target: 1 }];

  // Simulate quest turn-in via the quest engine.
  const { turnInQuest } = await import("../src/questEngine");
  const error = turnInQuest(player.questState, "quest.warrior_job_1", player);
  assert.strictEqual(error, "", "quest turn-in should succeed");

  // Verify advancement.
  assert.strictEqual(player.archetype, ClassArchetype.WARRIOR, "archetype should be WARRIOR");
  assert.strictEqual(player.jobTier, 1, "jobTier should be 1");

  const expectedMaxHp = maxHpForLevel(ClassArchetype.WARRIOR, 10);
  const expectedMaxMp = maxMpForLevel(ClassArchetype.WARRIOR, 10);
  assert.strictEqual(player.maxHp, expectedMaxHp, "maxHp recomputed for Warrior");
  assert.strictEqual(player.hp, expectedMaxHp, "hp full heal");
  assert.strictEqual(player.maxMp, expectedMaxMp, "maxMp recomputed for Warrior");
  assert.strictEqual(player.mp, expectedMaxMp, "mp full heal");

  // Verify tier-1 skills granted.
  const tier1Skills = getClass(ClassArchetype.WARRIOR).jobTiers[0]!.skills;
  for (const skill of tier1Skills) {
    assert.ok(
      player.learnedSkills.includes(skill.id),
      `tier-1 skill "${skill.id}" should be granted via quest turn-in`,
    );
  }
  console.log(
    `[job-adv-quests] ✔ quest-driven Warrior advancement: skills [${tier1Skills.map((s) => s.id).join(", ")}]`,
  );

  // Verify persistence.
  const persisted = accountStore.getCharacter(rec.charId);
  assert.ok(persisted, "character should be persisted");
  assert.strictEqual(persisted!.archetype, "WARRIOR", "persisted archetype");
  assert.strictEqual(persisted!.jobTier, 1, "persisted jobTier");

  await sdkRoom.leave();
}

// ─── Test Suite 4: Branch persistence across sessions ──────────────────────

async function testBranchPersistence(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[job-adv-quests] ── branch persistence: Warrior → Berserker, rejoin ──");

  const accountId = `persist_test_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `PB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: {
      gender: "M",
      skinId: "skin_0",
      hairId: "hair_0",
      hairColorId: "hc_0",
      faceId: "face_0",
      outfitId: "outfit_0",
    },
  });
  accountStore.updateCharacter(rec.charId, {
    level: 30,
    exp: 0,
    archetype: ClassArchetype.WARRIOR,
    jobTier: 1,
    maxHp: maxHpForLevel(ClassArchetype.WARRIOR, 30),
    hp: maxHpForLevel(ClassArchetype.WARRIOR, 30),
    maxMp: maxMpForLevel(ClassArchetype.WARRIOR, 30),
    mp: maxMpForLevel(ClassArchetype.WARRIOR, 30),
    ap: 145,
    sp: 87,
  });

  // Set prerequisite quest as complete.
  const serverRoom1 = await colyseus.createRoom("craghold", {});
  const sdkRoom1 = await colyseus.connectTo(serverRoom1, {
    accountId,
    charId: rec.charId,
  });
  suppressMapNpcs(sdkRoom1);
  await sleep(250);

  const player1 = serverRoom1.state.players.get(sdkRoom1.sessionId);
  assert.ok(player1, "player exists");

  // Set prerequisite quest as turnedIn (not complete — otherwise handleTalkNpc intercepts with quest turn-in offer).
  const prereqQuestId = "quest.warrior_job_2";
  const prereqQuest = QUESTS[prereqQuestId];
  const existingPrereq = player1.questState.find((q) => q.questId === prereqQuestId);
  if (existingPrereq) {
    existingPrereq.status = "turnedIn";
  } else {
    player1.questState.push({
      questId: prereqQuestId,
      status: "turnedIn",
      objectiveProgress: prereqQuest!.objectives.map((o) => ({
        kind: o.kind,
        current: o.kind === "kill" ? o.count : 0,
        target: o.kind === "kill" ? o.count : 0,
      })),
    });
  }

  // Talk to instructor.
  const instructorNpc = (await import("@maple/shared")).NPCS["npc.craghold_instructor_warrior"];
  player1.x = instructorNpc.x + 10;
  player1.y = instructorNpc.y;

  const dp1 = waitForNumeric(sdkRoom1, MessageType.DIALOG, 3000);
  sdkRoom1.send(MessageType.TALK_NPC, { npcId: "npc.craghold_instructor_warrior" });
  await dp1;

  // Click Next to reach the branch node.
  const dp2 = waitForNumeric(sdkRoom1, MessageType.DIALOG, 3000);
  sdkRoom1.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  await dp2;

  // Click "I'm ready to advance!" → triggers advanceJob → BRANCH_LIST.
  const blPromise = waitForNumeric(sdkRoom1, MessageType.BRANCH_LIST, 3000);
  sdkRoom1.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  await blPromise;

  // Choose Berserker.
  const advPromise = waitForNumeric(sdkRoom1, MessageType.JOB_ADVANCE, 3000);
  sdkRoom1.send(MessageType.BRANCH_CHOICE, { branchId: "berserker" });
  const result = await advPromise;
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.branchId, "berserker");
  assert.strictEqual(player1.branchId, "berserker");
  assert.strictEqual(player1.jobTier, 2);

  // Leave and rejoin.
  await sdkRoom1.leave();
  await sleep(500);

  const serverRoom2 = await colyseus.createRoom("craghold", {});
  const sdkRoom2 = await colyseus.connectTo(serverRoom2, {
    accountId,
    charId: rec.charId,
  });
  suppressMapNpcs(sdkRoom2);
  await sleep(250);

  const player2 = serverRoom2.state.players.get(sdkRoom2.sessionId);
  assert.ok(player2, "player should exist after rejoin");
  assert.strictEqual(player2.branchId, "berserker", "branchId persisted across sessions");
  assert.strictEqual(player2.jobTier, 2, "jobTier persisted across sessions");
  assert.strictEqual(player2.archetype, ClassArchetype.WARRIOR, "archetype persisted");

  console.log("[job-adv-quests] ✔ branch persisted across sessions");

  await sdkRoom2.leave();
}

// ─── Test Suite 5: SP spending on new tier skills after advancement ────────

async function testSpSpendingAfterAdvancement(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[job-adv-quests] ── SP spending: learn Berserker tier-2 skill ──");

  const accountId = `sp_test_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `SP${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: {
      gender: "M",
      skinId: "skin_0",
      hairId: "hair_0",
      hairColorId: "hc_0",
      faceId: "face_0",
      outfitId: "outfit_0",
    },
  });
  // Set up as a level-30 Warrior with Berserker branch already chosen.
  accountStore.updateCharacter(rec.charId, {
    level: 30,
    exp: 0,
    archetype: ClassArchetype.WARRIOR,
    jobTier: 2,
    branchId: "berserker",
    maxHp: maxHpForLevel(ClassArchetype.WARRIOR, 30),
    hp: maxHpForLevel(ClassArchetype.WARRIOR, 30),
    maxMp: maxMpForLevel(ClassArchetype.WARRIOR, 30),
    mp: maxMpForLevel(ClassArchetype.WARRIOR, 30),
    ap: 145,
    sp: 87,
    learnedSkills: getClass(ClassArchetype.WARRIOR).jobTiers[0]!.skills.map((s) => s.id),
    skillBook: Object.fromEntries(
      getClass(ClassArchetype.WARRIOR).jobTiers[0]!.skills.map((s) => [s.id, 1]),
    ),
  });

  const serverRoom = await colyseus.createRoom("craghold", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  suppressMapNpcs(sdkRoom);
  await sleep(250);

  const player = serverRoom.state.players.get(sdkRoom.sessionId);
  assert.ok(player, "player exists");
  assert.strictEqual(player.branchId, "berserker");
  assert.strictEqual(player.jobTier, 2);

  const spBefore = player.sp;
  assert.ok(spBefore > 0, "should have SP to spend");

  // Try to learn a Berserker tier-2 skill: "warrior.cleave".
  const learnPromise = waitForNumeric(sdkRoom, MessageType.LEARN_SKILL, 3000);
  sdkRoom.send(MessageType.LEARN_SKILL, { skillId: "warrior.cleave" });
  const learnResult = await learnPromise;

  assert.strictEqual(
    learnResult.success,
    true,
    `learnSkill should succeed: ${learnResult.message}`,
  );
  assert.strictEqual(learnResult.sp, spBefore - 1, "SP should decrease by 1");
  assert.ok(player.skillBook["warrior.cleave"] >= 1, "cleave should be in skillBook");
  console.log(`[job-adv-quests] ✔ learned warrior.cleave, SP: ${spBefore} → ${learnResult.sp}`);

  // Verify the skill is in the skill book.
  assert.ok(player.skillBook["warrior.cleave"] >= 1, "cleave level in skillBook");

  // Verify wrong-branch skill is rejected: Glaciemancer's Frost Bolt shouldn't work.
  const rejectPromise = waitForNumeric(sdkRoom, MessageType.LEARN_SKILL, 3000);
  sdkRoom.send(MessageType.LEARN_SKILL, { skillId: "mage.frost_bolt" });
  const rejectResult = await rejectPromise;
  assert.strictEqual(rejectResult.success, false, "wrong-class skill should be rejected");
  console.log(`[job-adv-quests] ✔ wrong-class skill rejected: ${rejectResult.message}`);

  await sdkRoom.leave();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  const allClasses = [
    ClassArchetype.WARRIOR,
    ClassArchetype.MAGE,
    ClassArchetype.ARCHER,
    ClassArchetype.THIEF,
    ClassArchetype.PIRATE,
  ];

  // 1st-job advancement for all 5 classes.
  for (const cls of allClasses) {
    await testFirstJobAdvancement(colyseus, cls);
  }

  // 2nd-job advancement: first branch for each class.
  const branchChoices: [ClassArchetype, string][] = [
    [ClassArchetype.WARRIOR, "berserker"],
    [ClassArchetype.MAGE, "pyromancer"],
    [ClassArchetype.ARCHER, "longbow"],
    [ClassArchetype.THIEF, "bladecaller"],
    [ClassArchetype.PIRATE, "brawler"],
  ];

  for (const [cls, branch] of branchChoices) {
    await testSecondJobAdvancement(colyseus, cls, branch);
  }

  // Quest-driven advancement.
  await testQuestDrivenAdvancement(colyseus);

  // Branch persistence.
  await testBranchPersistence(colyseus);

  // SP spending on new tier skills.
  await testSpSpendingAfterAdvancement(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[job-adv-quests] PASS ✔  all job advancement + quest chain tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[job-adv-quests] FAIL ✘", err);
  process.exit(1);
});
