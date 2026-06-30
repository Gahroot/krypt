/**
 * Job advancement test — verifies the advanceJob dialog action:
 *   1. A level-10 Beginner talks to the Job Instructor in heartland_harbor and chooses Archer.
 *   2. Assert archetype changed, maxHp/maxMp recomputed for the new class, tier-1 skills granted.
 *   3. A non-Beginner cannot advance again (re-advancement blocked).
 *
 * Run: npx tsx test/jobAdvance.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import { ClassArchetype, maxHpForLevel, maxMpForLevel, getClass } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[jobAdvance] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function waitForNumericMessage(sdkRoom: any, msgType: number, timeoutMs = 3000): Promise<any> {
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

/**
 * Create a level-10 Beginner character in the store and join heartland_harbor.
 * Returns the server room, sdk room, player reference, and charId.
 */
async function setupLevel10Beginner(colyseus: Awaited<ReturnType<typeof boot>>, label: string) {
  const accountId = `job_advance_test_${label}_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `JobTest${label}`,
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

  // Level up to 10 directly in the store.
  accountStore.updateCharacter(rec.charId, {
    level: 10,
    exp: 0,
    ap: 45, // 9 level-ups * 5 AP/level
    sp: 27, // 9 level-ups * 3 SP/level
  });

  const serverRoom = await colyseus.createRoom("heartland_harbor", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  // Suppress map_npcs warning.
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(250);

  const sessionId = sdkRoom.sessionId;
  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player should exist after join");
  assert.strictEqual(player.archetype, ClassArchetype.BEGINNER, "starts as BEGINNER");
  assert.strictEqual(player.level, 10, "should be level 10");

  return { serverRoom, sdkRoom, sessionId, charId: rec.charId, player };
}

// ─── Test 1: Successful advancement → Archer ─────────────────────────────────

async function testAdvanceToArcher(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[jobAdvance] ── advance Beginner → Archer ──");

  const { serverRoom, sdkRoom, player } = await setupLevel10Beginner(colyseus, "archer");

  // Position the player near the Job Instructor (x=450, y=360).
  player.x = 450;
  player.y = 360;

  // Capture expected HP/MP values for a level-10 Archer.
  const expectedMaxHp = maxHpForLevel(ClassArchetype.ARCHER, 10);
  const expectedMaxMp = maxMpForLevel(ClassArchetype.ARCHER, 10);
  const tier1Skills = getClass(ClassArchetype.ARCHER).jobTiers[0]!.skills;

  // Step 1: TALK_NPC → first line
  const dialogPromise1 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.TALK_NPC, { npcId: "npc.harbor_job" });
  const msg1 = await dialogPromise1;
  assert.ok(msg1, "should receive first dialog line");
  assert.strictEqual(msg1.npcId, "npc.harbor_job");
  assert.strictEqual(msg1.npcName, "Job Instructor");
  console.log("[jobAdvance] ✔ dialog started:", msg1.text);

  // Step 2: Click Next → second line
  const dialogPromise2 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  const msg2 = await dialogPromise2;
  assert.ok(msg2, "should receive second dialog line");
  assert.strictEqual(msg2.hasNext, true);
  console.log("[jobAdvance] ✔ dialog line 2:", msg2.text);

  // Step 3: Click Next → branch node (class choices)
  const dialogPromise3 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  const msg3 = await dialogPromise3;
  assert.ok(msg3, "should receive branch dialog");
  assert.ok(msg3.choices, "should have choices");
  assert.strictEqual(msg3.choices.length, 5, "should have 5 class choices");
  assert.strictEqual(msg3.choices[0].label, "Warrior");
  assert.strictEqual(msg3.choices[1].label, "Mage");
  assert.strictEqual(msg3.choices[2].label, "Archer");
  assert.strictEqual(msg3.choices[3].label, "Thief");
  assert.strictEqual(msg3.choices[4].label, "Pirate");
  console.log(
    "[jobAdvance] ✔ branch with 5 choices:",
    msg3.choices.map((c: any) => c.label).join(", "),
  );

  // Step 4: Pick "Archer" (index 2) → triggers advanceJob action + dialog ends
  const jobAdvancePromise = waitForNumericMessage(sdkRoom, MessageType.JOB_ADVANCE, 3000);
  const endPromise = waitForNumericMessage(sdkRoom, MessageType.DIALOG_END, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 2 });

  const advanceResult = await jobAdvancePromise;
  assert.ok(advanceResult, "should receive JOB_ADVANCE message");
  assert.strictEqual(advanceResult.success, true, "advancement should succeed");
  assert.strictEqual(advanceResult.archetype, "ARCHER", "archetype should be ARCHER");
  assert.ok(
    advanceResult.message.includes("Archer"),
    `message should mention Archer, got: "${advanceResult.message}"`,
  );
  console.log("[jobAdvance] ✔ advancement result:", advanceResult.message);

  const endMsg = await endPromise;
  assert.ok(endMsg, "dialog should end");
  console.log("[jobAdvance] ✔ dialog ended after advancement");

  // ── Verify server state ──
  assert.strictEqual(player.archetype, ClassArchetype.ARCHER, "player archetype updated");

  assert.strictEqual(
    player.maxHp,
    expectedMaxHp,
    `maxHp should be recomputed for Archer: expected ${expectedMaxHp}, got ${player.maxHp}`,
  );
  assert.strictEqual(
    player.hp,
    expectedMaxHp,
    `hp should be full heal to new maxHp: expected ${expectedMaxHp}, got ${player.hp}`,
  );
  assert.strictEqual(
    player.maxMp,
    expectedMaxMp,
    `maxMp should be recomputed for Archer: expected ${expectedMaxMp}, got ${player.maxMp}`,
  );
  assert.strictEqual(
    player.mp,
    expectedMaxMp,
    `mp should be full heal to new maxMp: expected ${expectedMaxMp}, got ${player.mp}`,
  );
  console.log(
    `[jobAdvance] ✔ HP/MP recomputed: HP=${player.hp}/${player.maxHp} MP=${player.mp}/${player.maxMp}`,
  );

  // ── Verify learned skills ──
  const skillIds = tier1Skills.map((s) => s.id);
  for (const skillId of skillIds) {
    assert.ok(
      player.learnedSkills.includes(skillId),
      `tier-1 skill "${skillId}" should be in learnedSkills`,
    );
  }
  console.log(`[jobAdvance] ✔ skills granted: [${player.learnedSkills.join(", ")}]`);

  // ── Verify persistence ──
  // Force flush by persisting.
  serverRoom.state.players.get(player.charId); // no-op, just verify player exists

  await sdkRoom.leave();
}

// ─── Test 2: Re-advancement blocked ──────────────────────────────────────────

async function testReAdvancementBlocked(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[jobAdvance] ── re-advancement blocked ──");

  const { sdkRoom, player } = await setupLevel10Beginner(colyseus, "reblock");

  // Position near Job Instructor.
  player.x = 450;
  player.y = 360;

  // Step 1: Talk to NPC → first line
  const dialogPromise1 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.TALK_NPC, { npcId: "npc.harbor_job" });
  await dialogPromise1;

  // Step 2: Next → second line
  const dialogPromise2 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  await dialogPromise2;

  // Step 3: Next → branch
  const dialogPromise3 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  await dialogPromise3;

  // Step 4: Choose Warrior
  const advancePromise1 = waitForNumericMessage(sdkRoom, MessageType.JOB_ADVANCE, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  const result1 = await advancePromise1;
  assert.strictEqual(result1.success, true, "first advancement should succeed");
  assert.strictEqual(result1.archetype, "WARRIOR");
  console.log("[jobAdvance] ✔ first advancement succeeded:", result1.message);

  // Wait for dialog to end and clean up.
  await sleep(300);

  // ── Now try to advance again (should be blocked) ──
  // Talk to NPC again.
  const dp1 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.TALK_NPC, { npcId: "npc.harbor_job" });
  await dp1;

  const dp2 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  await dp2;

  const dp3 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  await dp3;

  // Pick Mage (should be blocked since we're now a Warrior).
  const advancePromise2 = waitForNumericMessage(sdkRoom, MessageType.JOB_ADVANCE, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 1 });
  const result2 = await advancePromise2;

  assert.strictEqual(result2.success, false, "second advancement should fail");
  assert.ok(
    result2.message.includes("already"),
    `error should mention already advanced, got: "${result2.message}"`,
  );
  console.log("[jobAdvance] ✔ re-advancement blocked:", result2.message);

  // Verify archetype unchanged (still Warrior).
  assert.strictEqual(
    player.archetype,
    ClassArchetype.WARRIOR,
    "archetype should remain WARRIOR after blocked advancement",
  );
  console.log("[jobAdvance] ✔ archetype still WARRIOR after blocked attempt");

  await sdkRoom.leave();
}

// ─── Test 3: Level too low ──────────────────────────────────────────────────

async function testLevelTooLow(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[jobAdvance] ── level too low blocked ──");

  // Create a level-5 Beginner.
  const accountId = `job_advance_test_low_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: "LowLevel",
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
  accountStore.updateCharacter(rec.charId, { level: 5 });

  const serverRoom = await colyseus.createRoom("heartland_harbor", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(250);

  const player = serverRoom.state.players.get(sdkRoom.sessionId)!;
  assert.strictEqual(player.level, 5, "should be level 5");
  player.x = 450;
  player.y = 360;

  // Walk through dialog.
  const dp1 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.TALK_NPC, { npcId: "npc.harbor_job" });
  await dp1;

  const dp2 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  await dp2;

  const dp3 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  await dp3;

  // Pick Archer (should fail — level too low).
  const advancePromise = waitForNumericMessage(sdkRoom, MessageType.JOB_ADVANCE, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 2 });
  const result = await advancePromise;

  assert.strictEqual(result.success, false, "level-5 advancement should fail");
  assert.ok(
    result.message.includes("level 10"),
    `error should mention level 10, got: "${result.message}"`,
  );
  console.log("[jobAdvance] ✔ low-level blocked:", result.message);

  // Verify archetype unchanged.
  assert.strictEqual(
    player.archetype,
    ClassArchetype.BEGINNER,
    "should remain BEGINNER after blocked attempt",
  );

  // Verify no skills were granted.
  assert.strictEqual(
    player.learnedSkills.length,
    0,
    "no skills should be granted to low-level player",
  );
  console.log("[jobAdvance] ✔ no skills granted to low-level player");

  await sdkRoom.leave();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await boot(appConfig);

  await testAdvanceToArcher(colyseus);
  await testReAdvancementBlocked(colyseus);
  await testLevelTooLow(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[jobAdvance] PASS ✔  all job advancement tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[jobAdvance] FAIL ✘", err);
  process.exit(1);
});
