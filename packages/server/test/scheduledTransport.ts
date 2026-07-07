/**
 * Scheduled transport tests — verify the airship/boat departure cycle.
 *
 * 1. Player boards a scheduled transport during the boarding window → receives TRANSPORT_STATUS.
 * 2. Player blocked outside boarding window → receives "not currently boarding" message.
 * 3. Boarded players are teleported when the boarding window closes → TRANSPORT_DEPARTED + TRAVEL.
 * 4. Static validation: all scheduled portals have valid intervalMs/windowMs metadata.
 *
 * Uses @colyseus/testing createRoom + connectTo.
 *
 * Run: pnpm --filter @maple/server exec tsx test/scheduledTransport.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { getMap, MAPS } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard watchdog so the process can never hang.
const watchdog = setTimeout(() => {
  console.error("[transport] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Wait for a specific numeric message type from the SDK room.
 */
function waitForMessage(sdkRoom: any, msgType: number, timeoutMs = 5000): Promise<any> {
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

/** Collect multiple messages of a given type within a time window. */
function collectMessages(sdkRoom: any, msgType: number, windowMs: number): Promise<any[]> {
  return new Promise((resolve) => {
    const msgs: any[] = [];
    const handler = (message: any) => msgs.push(message);
    sdkRoom.onMessage(msgType, handler);
    setTimeout(() => {
      sdkRoom.offMessage(msgType, handler);
      resolve(msgs);
    }, windowMs);
  });
}

async function setupPlayerAt(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
  mapId: string,
  level: number,
  accountLabel: string,
  pos: { x: number; y: number },
) {
  const accountId = `transport_test_${accountLabel}_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `T${level}_${Date.now()}`,
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
  accountStore.updateCharacter(rec.charId, { level });

  const serverRoom = await colyseus.createRoom(mapId, {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  await sleep(250);

  const sessionId = sdkRoom.sessionId;
  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player should exist in server state after join");
  player.x = pos.x;
  player.y = pos.y;
  player.level = level;

  return { serverRoom, sdkRoom, sessionId, charId: rec.charId, accountId };
}

// ─── Test 1: Static validation of all scheduled portals ─────────────────────

async function testScheduledPortalMetadata() {
  console.log("[transport] ── static validation: scheduled portal metadata ──");
  let count = 0;

  for (const [_mapId, map] of Object.entries(MAPS)) {
    for (const portal of map.portals) {
      if (!portal.schedule) continue;
      count++;
      assert.ok(
        portal.schedule.intervalMs > 0,
        `[${map.id}] portal "${portal.id}" intervalMs must be > 0`,
      );
      assert.ok(
        portal.schedule.windowMs > 0,
        `[${map.id}] portal "${portal.id}" windowMs must be > 0`,
      );
      assert.ok(
        portal.schedule.windowMs < portal.schedule.intervalMs,
        `[${map.id}] portal "${portal.id}" windowMs must be < intervalMs`,
      );
      assert.ok(portal.toMapId, `[${map.id}] portal "${portal.id}" must have a destination`);
    }
  }

  assert.ok(count > 0, "should find at least one scheduled portal");
  console.log(`[transport] ✔ ${count} scheduled portals validated`);
}

// ─── Test 2: Board during boarding window ───────────────────────────────────

async function testBoardDuringWindow(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[transport] ── board during boarding window ──");

  // Use Crossway → Skyhaven airship (Lv 30, 5-min interval, 1-min window).
  const crossway = getMap("crossway")!;
  const airship = crossway.portals.find((p) => p.id === "airship_to_skyhaven")!;
  assert.ok(airship.schedule, "airship_to_skyhaven should have schedule");

  const { sdkRoom, serverRoom, sessionId } = await setupPlayerAt(
    colyseus,
    "crossway",
    30,
    "board",
    { x: airship.x, y: airship.y },
  );

  // The room was just created, so transportEpoch ≈ Date.now() and phase ≈ 0,
  // which is inside the boarding window (windowMs = 60_000).

  // USE_PORTAL should board us and send TRANSPORT_STATUS.
  const statusPromise = waitForMessage(sdkRoom, MessageType.TRANSPORT_STATUS);
  sdkRoom.send(MessageType.USE_PORTAL);

  const status = await statusPromise;
  assert.strictEqual(status.portalId, "airship_to_skyhaven", "portal id should match");
  assert.ok(status.departInMs > 0, "departure should be in the future");
  assert.ok(status.departInMs <= airship.schedule!.windowMs, "departure should be ≤ window");
  assert.strictEqual(status.boardedCount, 1, "should have 1 passenger");
  assert.ok(status.portalLabel.includes("Skyhaven"), "label should mention Skyhaven");

  console.log("[transport] ✔ boarded with status:", status.departInMs, "ms until departure");

  await sdkRoom.leave();
}

// ─── Test 3: Blocked outside boarding window ────────────────────────────────

async function testBlockedOutsideWindow(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[transport] ── blocked outside boarding window ──");

  const crossway = getMap("crossway")!;
  const airship = crossway.portals.find((p) => p.id === "airship_to_skyhaven")!;

  const { sdkRoom, serverRoom } = await setupPlayerAt(colyseus, "crossway", 30, "blocked", {
    x: airship.x,
    y: airship.y,
  });

  // Manipulate transportEpoch so we're outside the boarding window.
  // If epoch = Date.now() + (intervalMs - windowMs - 5000), then phase will be
  // near the end of the waiting period (outside the window).
  //
  // phase = (now - epoch) % intervalMs
  // epoch = now - (intervalMs - windowMs - 5000)
  // phase = (now - (now - (intervalMs - windowMs - 5000))) % intervalMs
  //       = (intervalMs - windowMs - 5000) % intervalMs
  //       = intervalMs - windowMs - 5000  (positive, > windowMs since intervalMs >> windowMs + 5000)
  // Since intervalMs - windowMs = 240_000 and we add 5_000, phase = 245_000 > windowMs(60_000) ✓
  const intervalMs = airship.schedule!.intervalMs;
  const windowMs = airship.schedule!.windowMs;
  (serverRoom as any).transportEpoch = Date.now() - (intervalMs - windowMs - 5_000);
  await sleep(50); // let epoch settle

  const blockedPromise = waitForMessage(sdkRoom, MessageType.USE_PORTAL);
  sdkRoom.send(MessageType.USE_PORTAL);

  const msg = await blockedPromise;
  assert.ok(msg.message, "should have a message");
  assert.ok(
    msg.message.includes("not currently boarding"),
    `should say "not currently boarding", got: "${msg.message}"`,
  );

  console.log("[transport] ✔ blocked:", msg.message);

  await sdkRoom.leave();
}

// ─── Test 4: Departure teleports boarded players ────────────────────────────

async function testDepartureTeleports(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[transport] ── departure teleports boarded players ──");

  const crossway = getMap("crossway")!;
  const airship = crossway.portals.find((p) => p.id === "airship_to_skyhaven")!;

  const { sdkRoom, serverRoom, sessionId } = await setupPlayerAt(
    colyseus,
    "crossway",
    30,
    "depart",
    { x: airship.x, y: airship.y },
  );

  // Set epoch so we're 2 seconds before the end of the boarding window.
  // phase = (now - epoch) % intervalMs
  // We want phase = windowMs - 2000
  // epoch = now - (windowMs - 2000)
  const windowMs = airship.schedule!.windowMs;
  (serverRoom as any).transportEpoch = Date.now() - (windowMs - 2_000);
  await sleep(50);

  // Board the player.
  const boardPromise = waitForMessage(sdkRoom, MessageType.TRANSPORT_STATUS);
  sdkRoom.send(MessageType.USE_PORTAL);
  const status = await boardPromise;
  assert.ok(status.departInMs > 0, "should have positive departure time");
  console.log("[transport]   boarded, departure in", status.departInMs, "ms");

  // Wait for TRANSPORT_DEPARTED (should arrive within ~3 seconds when window closes).
  const departedPromise = waitForMessage(sdkRoom, MessageType.TRANSPORT_DEPARTED, 8000);
  const travelPromise = waitForMessage(sdkRoom, MessageType.TRAVEL, 8000);

  const departed = await departedPromise;
  assert.strictEqual(departed.mapId, "skyhaven", "should depart to skyhaven");
  console.log("[transport]   departed:", departed.portalLabel);

  const travel = await travelPromise;
  assert.strictEqual(travel.mapId, "skyhaven", "TRAVEL should target skyhaven");
  assert.strictEqual(travel.spawnId, "from_airship", "should arrive at from_airship spawn");

  console.log("[transport] ✔ player teleported to", travel.mapId, "at", travel.spawnId);

  await sdkRoom.leave();
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testScheduledPortalMetadata();
  await testBoardDuringWindow(colyseus);
  await testBlockedOutsideWindow(colyseus);
  await testDepartureTeleports(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[transport] PASS ✔ all scheduled transport tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[transport] FAIL ✘", err);
  process.exit(1);
});
