/**
 * NPC dialog test — verifies server-authoritative NPC dialog round-trip.
 *
 * 1. Positions a player near Guide Iris on Dawn Isle, sends TALK_NPC,
 *    and walks through the full dialog tree including choices and actions.
 * 2. Positions a player far from any NPC and verifies TALK_NPC is rejected.
 *
 * Uses @colyseus/testing createRoom + connectTo for both server state and SDK messaging.
 *
 * Run: npx tsx test/npcs.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";
import { NPCS } from "@maple/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard watchdog so the process can never hang a harness.
const watchdog = setTimeout(() => {
  console.error("[npcs] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

/**
 * Helper: create a character, join dawn_isle, and position the player.
 */
async function setupPlayer(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
  x: number,
  y: number,
  accountLabel: string,
) {
  const accountId = `npc_test_${accountLabel}_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `Dialog${accountLabel}_${Date.now()}`,
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
  // Suppress the "onMessage() not registered" warning for map_npcs sent on join.
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(250);

  const sessionId = sdkRoom.sessionId;
  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player should exist in server state after join");
  player.x = x;
  player.y = y;

  return { serverRoom, sdkRoom, sessionId, charId: rec.charId, accountId };
}

/**
 * Wait for a specific numeric message type from the SDK room.
 */
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
 * Wait for a named message type (string key) from the SDK room.
 */
function waitForNamedMessage(sdkRoom: any, msgName: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`message "${msgName}" was not called within ${timeoutMs}ms`));
    }, timeoutMs);
    sdkRoom.onMessage(msgName, (message: any) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

// ─── Test: full dialog round-trip with Guide Iris ────────────────────────────

async function testDialogRoundTrip(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[npcs] ── dialog round-trip with Guide Iris ──");

  // Guide Iris is at (225, 80). Position player right next to her.
  const { serverRoom, sdkRoom, sessionId } = await setupPlayer(colyseus, 225, 80, "iris");

  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player exists");

  // Verify Iris exists on dawn_isle.
  const iris = NPCS["npc.dawn_guide"];
  assert.ok(iris, "Guide Iris should exist in catalog");
  assert.strictEqual(iris.mapId, "dawn_isle");

  // Verify player is within range.
  const dist = Math.hypot(iris.x - player.x, iris.y - player.y);
  assert.ok(dist <= 100, `player should be in range (dist=${Math.round(dist)})`);

  // ── Step 1: TALK_NPC → first line (node 0) ──
  const dialogPromise1 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.TALK_NPC, { npcId: "npc.dawn_guide" });

  const msg1 = await dialogPromise1;
  assert.ok(msg1, "should receive first dialog message");
  assert.strictEqual(msg1.npcId, "npc.dawn_guide");
  assert.strictEqual(msg1.npcName, "Guide Iris");
  assert.strictEqual(msg1.text, "Welcome to Dawn Isle! I'm Iris, your guide.");
  assert.strictEqual(msg1.hasNext, true, "node 0 should have hasNext=true (next=1)");
  assert.strictEqual(msg1.choices, undefined, "line node should not have choices");
  console.log("[npcs] ✔ node 0:", msg1.text);

  // Verify dialog state is set.
  assert.strictEqual(player.dialogNpcId, "npc.dawn_guide");
  assert.strictEqual(player.dialogNodeIndex, 0);

  // ── Step 2: DIALOG_CHOICE → advance to node 1 (second line) ──
  const dialogPromise2 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 }); // "Next"

  const msg2 = await dialogPromise2;
  assert.ok(msg2, "should receive second dialog message");
  assert.strictEqual(
    msg2.text,
    "Use arrow keys to move and Z to attack. Try it on the snails below!",
  );
  assert.strictEqual(msg2.hasNext, true, "node 1 should have hasNext=true (next=2)");
  console.log("[npcs] ✔ node 1:", msg2.text);

  // ── Step 3: DIALOG_CHOICE → advance to node 2 (branch) ──
  const dialogPromise3 = waitForNumericMessage(sdkRoom, MessageType.DIALOG, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 0 }); // "Next"

  const msg3 = await dialogPromise3;
  assert.ok(msg3, "should receive branch dialog message");
  assert.strictEqual(msg3.text, "What would you like to know?");
  assert.ok(msg3.choices, "branch should have choices");
  assert.strictEqual(msg3.choices.length, 3, "Iris should have 3 choices");
  assert.strictEqual(msg3.choices[0].label, "How do I fight?");
  assert.strictEqual(msg3.choices[1].label, "Where do I go?");
  assert.strictEqual(msg3.choices[2].label, "I'm ready to go!");
  console.log("[npcs] ✔ node 2 (branch):", msg3.text, `(${msg3.choices.length} choices)`);

  // ── Step 4: Pick choice 2 ("I'm ready to go!" → giveQuest quest.dawn_trio) ──
  // giveQuest sends quest_offer + DIALOG_END in same tick; register both first.
  const offerPromise = waitForNamedMessage(sdkRoom, "quest_offer", 3000);
  const endPromise = waitForNumericMessage(sdkRoom, MessageType.DIALOG_END, 3000);
  sdkRoom.send(MessageType.DIALOG_CHOICE, { choiceIndex: 2 });
  const offerMsg = await offerPromise;
  assert.ok(offerMsg, "should receive quest_offer message");
  assert.strictEqual(offerMsg.questId, "quest.dawn_trio");
  console.log("[npcs] ✔ quest_offer received:", offerMsg.questName);

  // Dialog ends (choice has no `next`).
  const endMsg = await endPromise;
  assert.ok(endMsg, "should receive dialog_end");
  assert.strictEqual(endMsg.npcId, "npc.dawn_guide");
  console.log("[npcs] ✔ dialog ended");

  // Verify player's dialog state is cleared.
  assert.strictEqual(player.dialogNpcId, "", "dialog state should be cleared");
  assert.strictEqual(player.dialogNodeIndex, 0, "dialog node should be reset");

  // Accept the quest after dialog ends
  const questPromise = waitForNumericMessage(sdkRoom, MessageType.QUEST_UPDATE, 3000);
  sdkRoom.send(MessageType.QUEST_ACCEPT, { questId: "quest.dawn_trio" });
  const questMsg = await questPromise;
  assert.ok(questMsg, "should receive quest_update message");
  const trioEntry = questMsg.quests.find((q: any) => q.questId === "quest.dawn_trio");
  assert.ok(trioEntry, "quest_update should include dawn_trio");
  assert.strictEqual(trioEntry.status, "active", "quest should be active");
  console.log("[npcs] ✔ quest accepted:", trioEntry.questId, trioEntry.status);

  await sdkRoom.leave();
}

// ─── Test: out-of-range TALK_NPC is rejected ─────────────────────────────────

async function testOutOfRangeRejected(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[npcs] ── out-of-range TALK_NPC rejected ──");

  // Position player far from any NPC (center of map, no NPC nearby).
  const { serverRoom, sdkRoom, sessionId } = await setupPlayer(colyseus, 600, 100, "far");

  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player exists");

  // Verify player is far from all Dawn Isle NPCs.
  const npcs = Object.values(NPCS).filter((n) => n.mapId === "dawn_isle");
  for (const npc of npcs) {
    const d = Math.hypot(npc.x - player.x, npc.y - player.y);
    assert.ok(d > 100, `player should be far from ${npc.id} (dist=${Math.round(d)})`);
  }

  // Register a listener for dialog — should NOT fire.
  let dialogReceived = false;
  sdkRoom.onMessage(MessageType.DIALOG, () => {
    dialogReceived = true;
  });

  // Send TALK_NPC to Guide Iris.
  sdkRoom.send(MessageType.TALK_NPC, { npcId: "npc.dawn_guide" });

  // Wait a bit and verify nothing came back.
  await sleep(500);
  assert.strictEqual(dialogReceived, false, "should NOT receive dialog when out of range");

  // Also verify player dialog state was never set.
  assert.strictEqual(player.dialogNpcId, "", "dialogNpcId should remain empty");

  console.log("[npcs] ✔ out-of-range TALK_NPC correctly rejected");
  await sdkRoom.leave();
}

// ─── Test: invalid NPC id is rejected ────────────────────────────────────────

async function testInvalidNpcRejected(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[npcs] ── invalid NPC id rejected ──");

  const { serverRoom, sdkRoom, sessionId } = await setupPlayer(colyseus, 225, 80, "invalid");

  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player exists");

  let dialogReceived = false;
  sdkRoom.onMessage(MessageType.DIALOG, () => {
    dialogReceived = true;
  });

  // Send TALK_NPC with a nonexistent NPC id.
  sdkRoom.send(MessageType.TALK_NPC, { npcId: "npc.nonexistent" });

  await sleep(500);
  assert.strictEqual(dialogReceived, false, "should NOT receive dialog for invalid NPC");
  assert.strictEqual(player.dialogNpcId, "", "dialogNpcId should remain empty for invalid NPC");

  console.log("[npcs] ✔ invalid NPC id correctly rejected");
  await sdkRoom.leave();
}

// ─── Test: NPCs exposed to client on join ────────────────────────────────────

async function testNpcsExposedOnJoin(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[npcs] ── NPCs exposed on join ──");

  // Build a fresh account + room, register the listener BEFORE connecting
  // so we capture the map_npcs message fired during onJoin.
  const accountId = `npc_test_join_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `JoinNpc_${Date.now()}`,
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
  // Register listener immediately after connect — in-process transport buffers
  // the onJoin message, so it arrives during the sleep below.
  const npcsPromise = waitForNamedMessage(sdkRoom, "map_npcs", 3000);
  await sleep(250); // flush the in-process transport buffer

  const npcsMsg = await npcsPromise;
  assert.ok(npcsMsg, "should receive map_npcs on join");
  assert.ok(Array.isArray(npcsMsg.npcs), "map_npcs should contain an npcs array");
  assert.ok(
    npcsMsg.npcs.length >= 3,
    `dawn_isle should have at least 3 NPCs, got ${npcsMsg.npcs.length}`,
  );

  // Verify NPC shapes have the expected fields.
  const iris = npcsMsg.npcs.find((n: any) => n.id === "npc.dawn_guide");
  assert.ok(iris, "should include Guide Iris");
  assert.strictEqual(iris.name, "Guide Iris");
  assert.strictEqual(iris.role, "guide");
  assert.strictEqual(typeof iris.x, "number");
  assert.strictEqual(typeof iris.y, "number");
  assert.strictEqual(typeof iris.spriteKey, "string");

  console.log(`[npcs] ✔ map_npcs sent on join: ${npcsMsg.npcs.length} NPCs`);
  await sdkRoom.leave();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testNpcsExposedOnJoin(colyseus);
  await testDialogRoundTrip(colyseus);
  await testOutOfRangeRejected(colyseus);
  await testInvalidNpcRejected(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[npcs] PASS ✔  all NPC dialog tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[npcs] FAIL ✘", err);
  process.exit(1);
});
