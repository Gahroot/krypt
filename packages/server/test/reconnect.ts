/**
 * Graceful-reconnection test for MapRoom.
 *
 * Proves the acceptance criteria for flaky-connection handling:
 *   1. A SHORT drop (within the grace window) followed by `sdk.reconnect()` resumes the
 *      SAME session in place — same sessionId, same position/state, no duplicate ghost.
 *   2. A LONGER drop (grace window elapses with no reconnect) cleanly removes the player
 *      from room state (so the client can fall back to character select) — no ghost left.
 *   3. A consented leave (`room.leave()`) persists the player on a true leave.
 *
 * The server-side grace window is shrunk to 1s here via MAPLE_RECONNECT_GRACE_SECONDS so
 * the timeout path is testable without a 20s wait. That env var is read in MapRoom.ts.
 *
 * Run: MAPLE_RECONNECT_GRACE_SECONDS=1 npx tsx test/reconnect.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[reconnect] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

const DEFAULT_APPEARANCE = {
  gender: "M",
  skinId: "skin_0",
  hairId: "hair_0",
  hairColorId: "hc_0",
  faceId: "face_0",
  outfitId: "outfit_0",
};

let counter = 0;
function makeChar(name: string) {
  const acct = `rc_${name}_${Date.now()}_${counter++}`;
  const rec = accountStore.createCharacter(acct, {
    name: `${name}${counter}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  return { acct, rec };
}

/**
 * Simulate a network drop: close the raw socket WITHOUT the Colyseus consented-leave
 * protocol message. The server sees an abnormal socket close (not CONSENTED/4000) and
 * routes it to `onDrop` → `allowReconnection`, holding the entity. (WebSocket.close()
 * forbids reserved code 1006, so we close with the default code — still non-consented.)
 */
function dropSocket(room: any): void {
  // Disable the SDK's own auto-reconnect so the test drives reconnection explicitly.
  room.reconnection.enabled = false;
  room.connection.close();
}

// ─── Test 1: short drop + reconnect resumes the same session in place ──────────

async function testShortDropResumes(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[reconnect] ── short drop → reconnect resumes in place ──");
  const { acct, rec } = makeChar("Flaky");

  const room = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(200);

  const serverRoom: any = colyseus.getRoomById(room.roomId);
  const sessionId = room.sessionId;
  const reconnectionToken = room.reconnectionToken;

  // Nudge the player so we have a non-spawn position to verify is preserved.
  for (let i = 0; i < 8; i++) {
    room.send(MessageType.INPUT, {
      left: false,
      right: true,
      up: false,
      down: false,
      attack: false,
      jump: false,
      interact: false,
      tick: i,
    });
    await sleep(40);
  }
  await sleep(150);

  const heldBefore = serverRoom.state.players.get(sessionId);
  assert.ok(heldBefore, "player must exist before drop");
  const savedX = heldBefore.x;
  const savedY = heldBefore.y;
  const savedMesos = heldBefore.mesos;
  assert.ok(savedX > 0, "player should have moved from spawn");

  // ── Drop the socket unexpectedly ──
  dropSocket(room);
  await sleep(300); // let the server process onDrop / allowReconnection

  // The entity is HELD: still in state, flagged disconnected, exactly one instance.
  const held = serverRoom.state.players.get(sessionId);
  assert.ok(held, "player entity must be HELD in room state during grace window");
  assert.strictEqual(held.connected, false, "held player should be flagged connected=false");
  assert.strictEqual(serverRoom.state.players.size, 1, "no duplicate/ghost player during drop");

  // ── Reconnect within the grace window ──
  const resumed = await colyseus.sdk.reconnect(reconnectionToken);
  await sleep(250);

  assert.strictEqual(resumed.sessionId, sessionId, "reconnect must reuse the same sessionId");
  assert.strictEqual(serverRoom.state.players.size, 1, "still exactly one player after reconnect");
  const after = serverRoom.state.players.get(sessionId);
  assert.ok(after, "player still present after reconnect");
  assert.strictEqual(after.connected, true, "reconnected player flagged connected=true");
  assert.strictEqual(after.x, savedX, "position X preserved across reconnect");
  assert.strictEqual(after.y, savedY, "position Y preserved across reconnect");
  assert.strictEqual(after.mesos, savedMesos, "mesos/state preserved across reconnect");

  await resumed.leave();
  await sleep(150);
  console.log("[reconnect]   ✔ same session resumed, position/state intact, no ghost");
}

// ─── Test 2: grace window elapses → entity cleaned up (no ghost) ───────────────

async function testTimeoutCleansUp(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[reconnect] ── long drop → grace elapses → clean removal ──");
  const { acct, rec } = makeChar("GoneCold");

  const room = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(200);

  const serverRoom: any = colyseus.getRoomById(room.roomId);
  const sessionId = room.sessionId;
  assert.ok(serverRoom.state.players.get(sessionId), "player present before drop");

  dropSocket(room);
  await sleep(300);
  assert.ok(serverRoom.state.players.get(sessionId), "player held immediately after drop");

  // Wait past the (test-shrunk) grace window so allowReconnection times out → onLeave.
  await sleep(1600);

  assert.strictEqual(
    serverRoom.state.players.get(sessionId),
    undefined,
    "player must be removed from state after grace window elapses (no ghost)",
  );
  console.log("[reconnect]   ✔ held entity cleanly removed after timeout, no ghost remains");
}

// ─── Test 3: consented leave persists on a true leave ──────────────────────────

async function testConsentedLeavePersists(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[reconnect] ── consented leave persists state ──");
  const { acct, rec } = makeChar("CleanExit");

  const room = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(200);

  const serverRoom: any = colyseus.getRoomById(room.roomId);
  const sessionId = room.sessionId;

  // Give the player some mesos via GM so we have a persisted delta to assert on.
  const player = serverRoom.state.players.get(sessionId);
  assert.ok(player, "player present");
  player.mesos = 12345;

  await room.leave(true); // consented — routes straight to onLeave
  await sleep(250);

  assert.strictEqual(
    serverRoom.state.players.get(sessionId),
    undefined,
    "consented leave removes the player from state",
  );
  const persisted = accountStore.getCharacter(rec.charId);
  assert.ok(persisted, "character record still exists after leave");
  assert.strictEqual(persisted!.mesos, 12345, "mesos persisted on a true (consented) leave");
  console.log("[reconnect]   ✔ persistence saved on a true leave");
}

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testShortDropResumes(colyseus);
  await testTimeoutCleansUp(colyseus);
  await testConsentedLeavePersists(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[reconnect] PASS ✔  graceful reconnection verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[reconnect] FAIL ✘", err);
  process.exit(1);
});
