/**
 * Portal travel test — verifies zone-to-zone travel via the ferry portal.
 *
 * 1. Level-10 character on the Dawn Isle ferry portal → expects TAVEL message to heartland_harbor.
 * 2. Level-5 character on the same portal → expects a "come back at level 10" blocked message.
 *
 * Uses @colyseus/testing createRoom + connectTo to get both the server Room (for state
 * manipulation) and the SDK room (for sending messages and receiving responses).
 *
 * Run: npx tsx test/portals.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import { getMap } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";

// Resolve the Dawn Isle → Heartland Harbor ferry portal from the shared map data
// (single source of truth) so the test tracks the authored portal position even
// when the map is re-laid-out, instead of hard-coding stale coordinates.
const DAWN_ISLE = getMap("dawn_isle");
if (!DAWN_ISLE) throw new Error("[portals] dawn_isle missing from shared map data");
const FERRY_PORTAL = DAWN_ISLE.portals.find((p) => p.toMapId === "heartland_harbor");
if (!FERRY_PORTAL) throw new Error("[portals] dawn_isle ferry portal missing from shared map data");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard watchdog so the process can never hang a harness.
const watchdog = setTimeout(() => {
  console.error("[portals] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

/**
 * Helper: create a character with a specific level in the account store,
 * then join the dawn_isle room and position the player at the ferry portal.
 */
async function setupPlayer(
  colyseus: Awaited<ReturnType<typeof boot>>,
  level: number,
  accountLabel: string,
) {
  const accountId = `portal_test_${accountLabel}_${Date.now()}`;

  // Pre-create a character at the desired level.
  const rec = accountStore.createCharacter(accountId, {
    name: `Ferry${level}`,
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

  // Set the character level directly in the store.
  accountStore.updateCharacter(rec.charId, { level });

  // Create room server-side, then connect a client.
  const serverRoom = await colyseus.createRoom("dawn_isle", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  await sleep(250); // let the first state patch arrive

  const sessionId = sdkRoom.sessionId;

  // Get the server-side player and position them on the ferry portal.
  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player should exist in server state after join");
  player.x = FERRY_PORTAL.x; // ferry portal x (from shared map data)
  player.y = FERRY_PORTAL.y; // ferry portal y (from shared map data)
  player.level = level;

  return { serverRoom, sdkRoom, sessionId, charId: rec.charId, accountId };
}

/**
 * Wait for a specific numeric message type from the SDK room.
 * Uses the raw onMessage callback instead of the testing extension's waitForMessage
 * (which has issues with numeric type keys).
 */
function waitForNumericMessage(sdkRoom: any, msgType: number, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`message type ${msgType} was not called within ${timeoutMs}ms`));
    }, timeoutMs);

    // Colyseus SDK's onMessage accepts numeric or string types.
    sdkRoom.onMessage(msgType, (message: any) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

async function testLevel10Travels(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[portals] ── level-10 ferry travel ──");
  const { serverRoom, sdkRoom, sessionId } = await setupPlayer(colyseus, 10, "lv10");

  // Verify player state before portal use.
  const p = serverRoom.state.players.get(sessionId);
  assert.ok(p, "player exists");
  assert.strictEqual(p.level, 10, "player should be level 10");
  assert.strictEqual(Math.round(p.x), FERRY_PORTAL.x, "player should be at portal x");
  assert.strictEqual(Math.round(p.y), FERRY_PORTAL.y, "player should be at portal y");

  // Register listener BEFORE sending to avoid race with in-process transport.
  const travelPromise = waitForNumericMessage(sdkRoom, MessageType.TRAVEL);

  // Send USE_PORTAL message.
  sdkRoom.send(MessageType.USE_PORTAL);

  // Wait for the TAVEL response.
  const msg = await travelPromise;
  assert.ok(msg, "should receive a TAVEL message");
  assert.strictEqual(msg.mapId, "heartland_harbor", "destination should be heartland_harbor");
  assert.strictEqual(msg.spawnId, "dock", "spawn point should be dock");
  console.log("[portals] ✔ level-10 traveled to", msg.mapId, "at spawn", msg.spawnId);

  await sdkRoom.leave();
}

async function testLevel5Blocked(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[portals] ── level-5 ferry blocked ──");
  const { serverRoom, sdkRoom, sessionId } = await setupPlayer(colyseus, 5, "lv5");

  // Verify player state.
  const p = serverRoom.state.players.get(sessionId);
  assert.ok(p, "player exists");
  assert.strictEqual(p.level, 5, "player should be level 5");

  // Register listener BEFORE sending to avoid race.
  // Server sends blocked message on same channel as USE_PORTAL (type 5).
  const blockedPromise = waitForNumericMessage(sdkRoom, MessageType.USE_PORTAL);

  // Send USE_PORTAL message.
  sdkRoom.send(MessageType.USE_PORTAL);

  // Wait for the blocked message.
  const msg = await blockedPromise;
  assert.ok(msg, "should receive a blocked message");
  assert.ok(msg.message, "blocked message should have text");
  assert.ok(msg.message.includes("level 10"), "blocked message should mention level 10");
  console.log("[portals] ✔ level-5 blocked:", msg.message);

  await sdkRoom.leave();
}

async function main() {
  const colyseus = await boot(appConfig);

  await testLevel10Travels(colyseus);
  await testLevel5Blocked(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[portals] PASS ✔  all portal tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[portals] FAIL ✘", err);
  process.exit(1);
});
