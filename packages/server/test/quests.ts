/**
 * Quest engine end-to-end test — accepts a kill quest, kills the required mobs,
 * and turns it in for rewards via auto-turn-in on NPC talk.
 *
 * Uses @colyseus/testing createRoom + connectTo for both server state and SDK messaging.
 *
 * Run: npx tsx test/quests.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";
import { QUESTS } from "@maple/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard watchdog so the process can never hang a harness.
const watchdog = setTimeout(() => {
  console.error("[quests] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 45_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupPlayer(colyseus: Awaited<ReturnType<typeof boot>>, accountId: string) {
  const rec = accountStore.createCharacter(accountId, {
    name: `Quest${Date.now()}`,
    archetype: "BEGINNER",
    appearance: {
      gender: "M",
      skinId: "skin_0",
      hairId: "hair_0",
      hairColorId: "hc_0",
      faceId: "face_0",
      outfitId: "outfit_0",
    },
  });

  const serverRoom = await colyseus.createRoom("dawn_isle", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  // Suppress map_npcs sent on join.
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(250);

  const sessionId = sdkRoom.sessionId;
  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player should exist after join");

  return { serverRoom, sdkRoom, sessionId, charId: rec.charId, accountId, player };
}

function waitForNumeric(sdkRoom: unknown, type: number, ms = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`msg ${type} timeout`)), ms);
    (sdkRoom as any).onMessage(type, (msg: any) => {
      clearTimeout(t);
      resolve(msg);
    });
  });
}

function waitForNamed(sdkRoom: unknown, name: string, ms = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`msg "${name}" timeout`)), ms);
    (sdkRoom as any).onMessage(name, (msg: any) => {
      clearTimeout(t);
      resolve(msg);
    });
  });
}

// ---------------------------------------------------------------------------
// Test: accept kill quest, kill mobs, auto-turn-in
// ---------------------------------------------------------------------------

async function testKillQuest(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[quests] ── kill quest: Pest Control ──");

  const accountId = `quest_test_kill_${Date.now()}`;
  const { serverRoom, sdkRoom, sessionId } = await setupPlayer(colyseus, accountId);
  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player exists");

  // ── Step 0: Verify initial quest state ──
  // quest_update is sent on join; register listener for future updates.
  const quest = QUESTS["quest.dawn_trio"];
  assert.ok(quest, "quest.dawn_trio exists");

  const dawnTrio = player.questState.find((q) => q.questId === "quest.dawn_trio");
  assert.ok(dawnTrio, "quest.dawn_trio should be in quest state after join");
  assert.strictEqual(dawnTrio.status, "available", "quest should start as available");
  console.log("[quests] ✔ initial state: available");

  // ── Step 1: Talk to Iris to accept the quest ──
  // Position player near Guide Iris (225, 80).
  player.x = 225;
  player.y = 80;

  // Navigate dialog: node 0 (line, next=1) → node 1 (line, next=2) → node 2 (branch)
  // Then pick choice 2 ("I'm ready to go!") which triggers giveQuest.

  // TALK_NPC to start dialog
  const d1 = waitForNumeric(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.TALK_NPC, { npcId: "npc.dawn_guide" });
  const msg1 = await d1;
  assert.strictEqual(msg1.text, "Welcome to Dawn Isle! I'm Iris, your guide.");

  // Advance to node 1
  const d2 = waitForNumeric(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  const msg2 = await d2;
  assert.strictEqual(
    msg2.text,
    "Use arrow keys to move and Z to attack. Try it on the snails below!",
  );

  // Advance to node 2 (branch)
  const d3 = waitForNumeric(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 });
  const msg3 = await d3;
  assert.ok(msg3.choices, "should be a branch node");

  // Pick choice 2 ("I'm ready to go!") → giveQuest action → sends quest_offer
  const offerPromise = waitForNamed(sdkRoom, "quest_offer", 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 2 });
  const offerMsg = await offerPromise;
  assert.ok(offerMsg, "should receive quest_offer");
  assert.strictEqual(offerMsg.questId, "quest.dawn_trio");
  console.log("[quests] ✔ quest_offer received:", offerMsg.questName);

  // Accept the quest offer
  const questUp = waitForNumeric(sdkRoom, MessageType.QUEST_UPDATE, 3000);
  sdkRoom.send(MessageType.QUEST_ACCEPT, { questId: "quest.dawn_trio" });
  const questMsg = await questUp;
  assert.ok(questMsg, "should receive quest_update after accept");

  // Verify quest is now active
  const trio = questMsg.quests.find((q: any) => q.questId === "quest.dawn_trio");
  assert.ok(trio, "quest_update should include dawn_trio");
  assert.strictEqual(trio.status, "active", "quest should be active after accept");
  assert.strictEqual(trio.objectiveProgress.length, 1, "should have 1 objective");
  assert.strictEqual(trio.objectiveProgress[0].kind, "kill");
  assert.strictEqual(trio.objectiveProgress[0].current, 0);
  assert.strictEqual(trio.objectiveProgress[0].target, 5);
  console.log("[quests] ✔ quest accepted: active, 0/5 kills");

  // ── Step 2: Kill 5 friendly_snail mobs ──
  // Find snail mobs in the room.
  const snailMobIds: string[] = [];
  for (const [id, mob] of serverRoom.state.mobs.entries()) {
    if (mob.mobId === "mob.friendly_snail") snailMobIds.push(id);
  }
  assert.ok(snailMobIds.length > 0, "should have friendly_snail mobs on dawn_isle");
  console.log(`[quests] found ${snailMobIds.length} friendly_snails`);

  // Simulate 5 kills via questEngine.progressObjectives (combat math tested in mobCombat.ts).
  const { progressObjectives } = await import("../src/questEngine.js");
  for (let i = 0; i < 5; i++) {
    progressObjectives(player.questState, "kill", "mob.friendly_snail", 1);
  }
  console.log("[quests] ✔ simulated 5 friendly_snail kills");

  // Check quest progress — look at server state directly.
  const trioState = player.questState.find((q) => q.questId === "quest.dawn_trio");
  assert.ok(trioState, "dawn_trio should still exist");
  console.log(
    `[quests] quest status=${trioState.status}, kill progress=${trioState.objectiveProgress[0].current}/${trioState.objectiveProgress[0].target}`,
  );

  assert.strictEqual(
    trioState.status,
    "complete",
    `quest should be "complete" after 5 kills, got "${trioState.status}"`,
  );
  assert.strictEqual(trioState.objectiveProgress[0].current, 5);
  console.log("[quests] ✔ quest objective complete: 5/5 kills");

  // ── Step 3: Turn in by talking to Iris again ──
  // Record mesos/exp before turn-in.
  const mesosBefore = player.mesos;

  // Reposition player near Iris for the turn-in dialog.
  player.x = 225;
  player.y = 80;

  // Talk to Iris — server sends quest_turnin_offer, then we accept.
  const turninOfferPromise = waitForNamed(sdkRoom, "quest_turnin_offer", 3000);
  sdkRoom.send(MessageType.TALK_NPC, { npcId: "npc.dawn_guide" });
  const turninOfferMsg = await turninOfferPromise;
  assert.ok(turninOfferMsg, "should receive quest_turnin_offer");
  assert.strictEqual(turninOfferMsg.questId, "quest.dawn_trio");
  assert.strictEqual(turninOfferMsg.questName, "Pest Control");
  console.log(`[quests] ✔ turn-in offer received for ${turninOfferMsg.questName}`);

  // Accept the turn-in.
  const turninPromise = waitForNamed(sdkRoom, "quest_turnin", 3000);
  sdkRoom.send(MessageType.QUEST_TURNIN_ACCEPT, { questId: "quest.dawn_trio" });
  const turninMsg = await turninPromise;
  assert.ok(turninMsg, "should receive quest_turnin after accept");
  assert.strictEqual(turninMsg.questId, "quest.dawn_trio");
  assert.strictEqual(turninMsg.mesos, quest.rewards.mesos);
  assert.strictEqual(turninMsg.exp, quest.rewards.exp);
  console.log(`[quests] ✔ turned in: +${turninMsg.mesos} mesos, +${turninMsg.exp} exp`);

  // Wait for dialog to also arrive (auto-turn-in fires before dialog).
  await sleep(200);

  // Verify rewards applied.
  assert.ok(
    player.mesos >= mesosBefore + (quest.rewards.mesos ?? 0),
    `mesos should increase by ${quest.rewards.mesos}`,
  );
  console.log(`[quests] ✔ mesos: ${mesosBefore} → ${player.mesos}`);

  // Verify quest state is now turnedIn.
  const trioAfter = player.questState.find((q) => q.questId === "quest.dawn_trio");
  assert.strictEqual(trioAfter.status, "turnedIn", "quest should be turnedIn");
  console.log("[quests] ✔ quest status: turnedIn");

  // ── Step 4: Block double turn-in ──
  const errResult = (await import("../src/questEngine.js")).turnInQuest(
    player.questState,
    "quest.dawn_trio",
    player,
  );
  assert.ok(typeof errResult === "string" && errResult.length > 0, "double turn-in should fail");
  console.log(`[quests] ✔ double turn-in blocked: "${errResult}"`);

  // ── Step 5: Block re-accept ──
  const acceptResult = (await import("../src/questEngine.js")).acceptQuest(
    player.questState,
    "quest.dawn_trio",
    player.level,
  );
  assert.ok(typeof acceptResult === "string", "re-accept should fail");
  console.log(`[quests] ✔ re-accept blocked: "${acceptResult}"`);

  await sdkRoom.leave();
}

// ---------------------------------------------------------------------------
// Test: accept quest then try to turn in early (objectives not complete)
// ---------------------------------------------------------------------------

async function testEarlyTurnInBlocked(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[quests] ── early turn-in blocked ──");

  const accountId = `quest_test_early_${Date.now()}`;
  const { serverRoom, sdkRoom, sessionId } = await setupPlayer(colyseus, accountId);
  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player exists");

  // Accept the quest via quest engine directly.
  const result = (await import("../src/questEngine.js")).acceptQuest(
    player.questState,
    "quest.dawn_trio",
    player.level,
  );
  assert.notStrictEqual(typeof result, "string", "accept should succeed");
  console.log("[quests] ✔ quest accepted via engine");

  // Try to turn in immediately (0/5 kills).
  const errResult = (await import("../src/questEngine.js")).turnInQuest(
    player.questState,
    "quest.dawn_trio",
    player,
  );
  assert.ok(typeof errResult === "string" && errResult.length > 0, "early turn-in should fail");
  console.log(`[quests] ✔ early turn-in blocked: "${errResult}"`);

  await sdkRoom.leave();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const colyseus = await boot(appConfig);

  await testKillQuest(colyseus);
  await testEarlyTurnInBlocked(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[quests] PASS ✔  all quest engine tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[quests] FAIL ✘", err);
  process.exit(1);
});
