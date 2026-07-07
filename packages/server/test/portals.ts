/**
 * Portal travel tests — comprehensive portal system verification.
 *
 * 1. Level-10 character on the Dawn Isle ferry portal → expects TRAVEL to heartland_harbor.
 * 2. Level-5 character on the same portal → expects "come back at level 10" blocked message.
 * 3. Static validation: every portal across all maps has valid foothold positioning,
 *    destination map exists, destination spawn point exists and is on a valid foothold.
 * 4. Portal chain traversal: dawn_isle → heartland_harbor → crossway in-game.
 * 5. Level-gate on mirefen_ruins portal (requiresLevel 20): Lv 15 blocked, Lv 20 passes.
 *
 * Uses @colyseus/testing createRoom + connectTo to get both the server Room (for state
 * manipulation) and the SDK room (for sending messages and receiving responses).
 *
 * Run: pnpm --filter @maple/server exec tsx test/portals.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { getMap, MAPS, groundYAt, type GameMap, type Foothold } from "@maple/shared";
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
}, 60_000);

/**
 * Helper: create a character with a specific level in the account store,
 * then join a map room and position the player at a given portal.
 */
async function setupPlayerAt(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
  mapId: string,
  level: number,
  accountLabel: string,
  pos: { x: number; y: number },
) {
  const accountId = `portal_test_${accountLabel}_${Date.now()}`;

  const rec = accountStore.createCharacter(accountId, {
    name: `P${level}_${Date.now()}`,
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

// Convenience wrapper matching the original setupPlayer signature.
async function setupPlayer(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
  level: number,
  accountLabel: string,
) {
  return setupPlayerAt(colyseus, "dawn_isle", level, accountLabel, FERRY_PORTAL);
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

// ─── Original tests ───────────────────────────────────────────────────────────

async function testLevel10Travels(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[portals] ── level-10 ferry travel ──");
  const { sdkRoom, sessionId, serverRoom } = await setupPlayer(colyseus, 10, "lv10");

  const p = serverRoom.state.players.get(sessionId);
  assert.ok(p, "player exists");
  assert.strictEqual(p.level, 10, "player should be level 10");
  assert.strictEqual(Math.round(p.x), FERRY_PORTAL.x, "player should be at portal x");
  assert.strictEqual(Math.round(p.y), FERRY_PORTAL.y, "player should be at portal y");

  const travelPromise = waitForNumericMessage(sdkRoom, MessageType.TRAVEL);
  sdkRoom.send(MessageType.USE_PORTAL);

  const msg = await travelPromise;
  assert.ok(msg, "should receive a TRAVEL message");
  assert.strictEqual(msg.mapId, "heartland_harbor", "destination should be heartland_harbor");
  assert.strictEqual(msg.spawnId, "dock", "spawn point should be dock");
  console.log("[portals] ✔ level-10 traveled to", msg.mapId, "at spawn", msg.spawnId);

  await sdkRoom.leave();
}

async function testLevel5Blocked(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[portals] ── level-5 ferry blocked ──");
  const { sdkRoom, serverRoom, sessionId } = await setupPlayer(colyseus, 5, "lv5");

  const p = serverRoom.state.players.get(sessionId);
  assert.ok(p, "player exists");
  assert.strictEqual(p.level, 5, "player should be level 5");

  const blockedPromise = waitForNumericMessage(sdkRoom, MessageType.USE_PORTAL);
  sdkRoom.send(MessageType.USE_PORTAL);

  const msg = await blockedPromise;
  assert.ok(msg, "should receive a blocked message");
  assert.ok(msg.message, "blocked message should have text");
  assert.ok(msg.message.includes("level 10"), "blocked message should mention level 10");
  console.log("[portals] ✔ level-5 blocked:", msg.message);

  await sdkRoom.leave();
}

// ─── Static validation: all portals & spawns across all maps ──────────────────

/** Max px a point can be ABOVE a foothold before it's "floating" (screen coords). */
const MAX_ABOVE_PX = 80;
/** Max px a point can be BELOW a foothold before it's "buried". */
const MAX_BELOW_PX = 10;

function checkPosition(map: GameMap, x: number, y: number): { ok: boolean; problem?: string } {
  if (map.footholds.length === 0) return { ok: true };

  let bestFh: Foothold | undefined;
  let bestAbsDy = Infinity;

  for (const fh of map.footholds) {
    const minX = Math.min(fh.x1, fh.x2);
    const maxX = Math.max(fh.x1, fh.x2);
    if (x < minX - 15 || x > maxX + 15) continue;

    const gY = groundYAt(fh, x);
    const absDy = Math.abs(y - gY);
    if (absDy < bestAbsDy) {
      bestAbsDy = absDy;
      bestFh = fh;
    }
  }

  if (!bestFh) {
    return { ok: false, problem: `no foothold covers x=${x}` };
  }

  const gY = groundYAt(bestFh, x);
  const dy = y - gY; // negative = above ground (correct for spawn), positive = buried

  if (dy < -MAX_ABOVE_PX) {
    return { ok: false, problem: `${(-dy).toFixed(0)}px above foothold (floating)` };
  }
  if (dy > MAX_BELOW_PX) {
    return { ok: false, problem: `${dy.toFixed(0)}px below foothold (buried)` };
  }

  return { ok: true };
}

async function testAllPortalsValid() {
  console.log("[portals] ── static validation: all portals & spawns ──");
  let errors = 0;

  for (const [mapId, map] of Object.entries(MAPS)) {
    // Check portals
    for (const portal of map.portals) {
      const pos = checkPosition(map, portal.x, portal.y);
      assert.ok(pos.ok, `[${mapId}] portal "${portal.id}" position invalid: ${pos.problem}`);

      if (portal.comingSoon) continue;

      const destMap = MAPS[portal.toMapId];
      assert.ok(
        destMap,
        `[${mapId}] portal "${portal.id}" destination "${portal.toMapId}" not in MAPS`,
      );

      const spawnId = portal.toSpawnId ?? "playerSpawn";
      const spawnPos =
        spawnId === "playerSpawn" ? destMap.playerSpawn : destMap.spawnPoints?.[spawnId];
      assert.ok(
        spawnPos,
        `[${mapId}] portal "${portal.id}" → spawn "${spawnId}" not found on "${destMap.id}"`,
      );

      const spawnCheck = checkPosition(destMap, spawnPos.x, spawnPos.y);
      assert.ok(
        spawnCheck.ok,
        `[${mapId}] portal "${portal.id}" → spawn "${spawnId}" on "${destMap.id}" invalid: ${spawnCheck.problem}`,
      );
    }

    // Check playerSpawn
    const ps = checkPosition(map, map.playerSpawn.x, map.playerSpawn.y);
    assert.ok(ps.ok, `[${mapId}] playerSpawn invalid: ${ps.problem}`);

    // Check named spawn points
    for (const [spawnId, pos] of Object.entries(map.spawnPoints ?? {})) {
      const s = checkPosition(map, pos.x, pos.y);
      assert.ok(s.ok, `[${mapId}] spawn "${spawnId}" invalid: ${s.problem}`);
    }

    errors++; // counter — assert.ok would have thrown if anything failed
  }

  console.log(
    `[portals] ✔ all ${Object.keys(MAPS).length} maps validated (portals, spawns, footholds)`,
  );
}

// ─── In-game portal chain traversal ──────────────────────────────────────────

async function testPortalTraversalChain(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[portals] ── portal chain: dawn_isle → heartland_harbor → crossway ──");

  // Leg 1: dawn_isle → heartland_harbor (ferry portal, level 10+)
  const leg1 = await setupPlayerAt(colyseus, "dawn_isle", 10, "chain1", {
    x: FERRY_PORTAL.x,
    y: FERRY_PORTAL.y,
  });

  const travel1 = waitForNumericMessage(leg1.sdkRoom, MessageType.TRAVEL);
  leg1.sdkRoom.send(MessageType.USE_PORTAL);
  const msg1 = await travel1;
  assert.strictEqual(msg1.mapId, "heartland_harbor", "leg1 → heartland_harbor");
  assert.strictEqual(msg1.spawnId, "dock", "leg1 → dock spawn");
  console.log("[portals]   leg1 ✔ dawn_isle → heartland_harbor (dock)");

  await leg1.sdkRoom.leave();

  // Leg 2: heartland_harbor → crossway
  const harbor = getMap("heartland_harbor")!;
  const toCrossway = harbor.portals.find((p) => p.toMapId === "crossway")!;

  const leg2 = await setupPlayerAt(colyseus, "heartland_harbor", 10, "chain2", {
    x: toCrossway.x,
    y: toCrossway.y,
  });

  const travel2 = waitForNumericMessage(leg2.sdkRoom, MessageType.TRAVEL);
  leg2.sdkRoom.send(MessageType.USE_PORTAL);
  const msg2 = await travel2;
  assert.strictEqual(msg2.mapId, "crossway", "leg2 → crossway");
  assert.ok(msg2.spawnId, "leg2 spawn id present");
  console.log("[portals]   leg2 ✔ heartland_harbor → crossway (" + msg2.spawnId + ")");

  await leg2.sdkRoom.leave();

  // Leg 3: crossway → meadowfield
  const crossway = getMap("crossway")!;
  const toMeadow = crossway.portals.find((p) => p.toMapId === "meadowfield")!;

  const leg3 = await setupPlayerAt(colyseus, "crossway", 10, "chain3", {
    x: toMeadow.x,
    y: toMeadow.y,
  });

  const travel3 = waitForNumericMessage(leg3.sdkRoom, MessageType.TRAVEL);
  leg3.sdkRoom.send(MessageType.USE_PORTAL);
  const msg3 = await travel3;
  assert.strictEqual(msg3.mapId, "meadowfield", "leg3 → meadowfield");
  console.log("[portals]   leg3 ✔ crossway → meadowfield (" + msg3.spawnId + ")");

  await leg3.sdkRoom.leave();

  console.log("[portals] ✔ full chain traversal verified (3 hops)");
}

// ─── Level-gate enforcement: mirefen ruins (Lv 20) ───────────────────────────

async function testLevelGateMirefenRuins(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[portals] ── level-gate: mirefen ruins (requiresLevel 20) ──");

  const mirefen = getMap("mirefen")!;
  const ruinsPortal = mirefen.portals.find((p) => p.toMapId === "mirefen_ruins")!;
  assert.strictEqual(ruinsPortal.requiresLevel, 20, "ruins portal should require level 20");

  // Lv 15 should be blocked
  const blocked = await setupPlayerAt(colyseus, "mirefen", 15, "ruins_block", {
    x: ruinsPortal.x,
    y: ruinsPortal.y,
  });
  const blockedMsg = waitForNumericMessage(blocked.sdkRoom, MessageType.USE_PORTAL);
  blocked.sdkRoom.send(MessageType.USE_PORTAL);
  const b = await blockedMsg;
  assert.ok(b.message, "blocked message should have text");
  assert.ok(
    b.message.includes("level 20"),
    `blocked message should mention level 20, got: "${b.message}"`,
  );
  console.log("[portals]   ✔ lv15 blocked:", b.message);
  await blocked.sdkRoom.leave();

  // Lv 20 should pass
  const pass = await setupPlayerAt(colyseus, "mirefen", 20, "ruins_pass", {
    x: ruinsPortal.x,
    y: ruinsPortal.y,
  });
  const travelMsg = waitForNumericMessage(pass.sdkRoom, MessageType.TRAVEL);
  pass.sdkRoom.send(MessageType.USE_PORTAL);
  const t = await travelMsg;
  assert.strictEqual(t.mapId, "mirefen_ruins", "lv20 should reach mirefen_ruins");
  assert.strictEqual(t.spawnId, "entry", "lv20 should land at entry spawn");
  console.log("[portals]   ✔ lv20 traveled to", t.mapId, "at spawn", t.spawnId);
  await pass.sdkRoom.leave();

  console.log("[portals] ✔ mirefen ruins level gate verified");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testLevel10Travels(colyseus);
  await testLevel5Blocked(colyseus);
  await testAllPortalsValid();
  await testPortalTraversalChain(colyseus);
  await testLevelGateMirefenRuins(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[portals] PASS ✔  all portal tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[portals] FAIL ✘", err);
  process.exit(1);
});
