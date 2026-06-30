/**
 * Single-live-session guard test — proves a character can only ever have ONE live
 * session, and that map/channel transfers are NOT mistaken for a duplicate login.
 *
 * Policy under test: a genuine second login KICKS the older session ("logged in
 * elsewhere"); a relocation that echoes the per-login generation token is recognised as
 * the same session moving and kicks nobody.
 *
 * Scenarios:
 *   1. Double login (same room)     → older session kicked, exactly one live session.
 *   2. Double login (cross-channel) → older session on ch0 kicked when ch1 login lands.
 *   3. Map/channel transfer w/ token → overlap is a continuation, no false kick.
 *
 * Run: npx tsx test/singleSession.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";
import { channelRegistry } from "../src/channelRegistry";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[singleSession] FAIL ✘ watchdog timeout");
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
  const acct = `ss_${name}_${Date.now()}_${counter++}`;
  const rec = accountStore.createCharacter(acct, {
    name: `${name}${counter}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  return { acct, rec };
}

// ─── Test 1: Double login on the same channel kicks the older session ────────

async function testDoubleLoginSameChannel(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[singleSession] ── double login (same channel) ──");
  const { acct, rec } = makeChar("Dup");

  const roomA = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(200);

  // The first session must own the single live session.
  assert.strictEqual(
    channelRegistry.ownerSessionId(rec.charId),
    roomA.sessionId,
    "first session should own the live session",
  );

  // Watch for the forced logout on the OLD session.
  let forcedOut = false;
  roomA.onMessage(MessageType.FORCE_LOGOUT, () => {
    forcedOut = true;
  });
  let leftA = false;
  roomA.onLeave(() => {
    leftA = true;
  });

  // Second login for the SAME character — a brand-new session (no generation token).
  const roomB = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(400);

  // The newer session now owns it; the older one was kicked.
  assert.strictEqual(
    channelRegistry.ownerSessionId(rec.charId),
    roomB.sessionId,
    "second session should now own the live session",
  );
  assert.ok(forcedOut, "older session should have received FORCE_LOGOUT");
  assert.ok(leftA, "older session should have been disconnected");

  // Exactly ONE live session remains for this character.
  assert.strictEqual(
    channelRegistry.sessionCountForChar(rec.charId),
    1,
    "exactly one live session should remain",
  );

  console.log("[singleSession] ✔ older session kicked, exactly one live session remains");
  await roomB.leave();
  await sleep(100);
  assert.strictEqual(
    channelRegistry.ownerSessionId(rec.charId),
    undefined,
    "ownership released after last session leaves",
  );
}

// ─── Test 2: Double login across channels kicks the older session ────────────

async function testDoubleLoginCrossChannel(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[singleSession] ── double login (cross-channel) ──");
  const { acct, rec } = makeChar("DupCh");

  const room0 = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(200);

  let forcedOut = false;
  room0.onMessage(MessageType.FORCE_LOGOUT, () => {
    forcedOut = true;
  });
  let left0 = false;
  room0.onLeave(() => {
    left0 = true;
  });

  // Fresh login on a DIFFERENT channel with NO generation token → duplicate login.
  const room1 = await colyseus.sdk.joinOrCreate("meadowfield__ch1", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(400);

  assert.ok(forcedOut, "ch0 session should be force-logged-out by the ch1 login");
  assert.ok(left0, "ch0 session should be disconnected");
  assert.strictEqual(
    channelRegistry.ownerSessionId(rec.charId),
    room1.sessionId,
    "ch1 session should own the single live session",
  );
  assert.strictEqual(
    channelRegistry.sessionCountForChar(rec.charId),
    1,
    "exactly one live session across channels",
  );

  console.log("[singleSession] ✔ cross-channel duplicate login kicked the older session");
  await room1.leave();
}

// ─── Test 3: A channel transfer (with generation token) is NOT a double login ─

async function testTransferIsNotDoubleLogin(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[singleSession] ── map/channel transfer (no false positive) ──");
  const { acct, rec } = makeChar("Mover");

  // Login on ch0 — the server issues a generation token for this session.
  const room0 = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(200);

  // The token the server issued — a real client receives this via SESSION_GENERATION
  // and echoes it on transfer. We read it authoritatively to model that echo.
  const generation = channelRegistry.ownerGeneration(rec.charId);
  assert.ok(generation, "server should have issued a generation token on login");

  // The transfer must NOT kick the relocating client.
  let forcedOut = false;
  room0.onMessage(MessageType.FORCE_LOGOUT, () => {
    forcedOut = true;
  });

  // Simulate the realistic transfer overlap: the NEW room's onJoin fires before the
  // OLD room's onLeave. Join ch1 (echoing the generation) WHILE still connected to ch0.
  const room1 = await colyseus.sdk.joinOrCreate("meadowfield__ch1", {
    charId: rec.charId,
    accountId: acct,
    generation,
    spawnId: "playerSpawn",
  });
  await sleep(300);

  // Continuation: nobody kicked, ownership moved to the new session, token preserved.
  assert.strictEqual(forcedOut, false, "a transfer must NOT trigger a force logout");
  assert.strictEqual(
    channelRegistry.ownerSessionId(rec.charId),
    room1.sessionId,
    "new channel session should own the live session after transfer",
  );
  assert.strictEqual(
    channelRegistry.ownerGeneration(rec.charId),
    generation,
    "generation token should carry across the transfer",
  );

  // Now the old room finally drains (late onLeave). It must NOT clobber the new owner.
  await room0.leave();
  await sleep(200);
  assert.strictEqual(
    channelRegistry.ownerSessionId(rec.charId),
    room1.sessionId,
    "late onLeave of the old session must not release the new owner",
  );
  assert.strictEqual(
    channelRegistry.sessionCountForChar(rec.charId),
    1,
    "exactly one live session after the transfer settles",
  );

  console.log("[singleSession] ✔ transfer recognised as continuation — no false double-login");
  await room1.leave();
}

// ─── Test 4: A cross-MAP transfer (with generation token) is NOT a double login ─

async function testCrossMapTransferIsNotDoubleLogin(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
) {
  console.log("[singleSession] ── cross-map transfer (no false positive) ──");
  const { acct, rec } = makeChar("Traveler");

  // Login on meadowfield — the server issues a generation token for this session.
  const roomA = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(200);
  const generation = channelRegistry.ownerGeneration(rec.charId);
  assert.ok(generation, "server should have issued a generation token on login");

  let forcedOut = false;
  roomA.onMessage(MessageType.FORCE_LOGOUT, () => {
    forcedOut = true;
  });

  // Travel to a DIFFERENT map (dawn_isle), echoing the generation, while the old map
  // room is still draining — exactly the portal-travel overlap a real client hits.
  const roomB = await colyseus.sdk.joinOrCreate("dawn_isle__ch0", {
    charId: rec.charId,
    accountId: acct,
    generation,
    spawnId: "playerSpawn",
  });
  await sleep(300);

  assert.strictEqual(forcedOut, false, "a cross-map transfer must NOT trigger a force logout");
  assert.strictEqual(
    channelRegistry.ownerSessionId(rec.charId),
    roomB.sessionId,
    "destination-map session should own the live session after the transfer",
  );
  assert.strictEqual(
    channelRegistry.ownerGeneration(rec.charId),
    generation,
    "generation token should carry across the map transfer",
  );

  await roomA.leave();
  await sleep(200);
  assert.strictEqual(
    channelRegistry.sessionCountForChar(rec.charId),
    1,
    "exactly one live session after the cross-map transfer settles",
  );

  console.log("[singleSession] ✔ cross-map transfer recognised as continuation — no false kick");
  await roomB.leave();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testDoubleLoginSameChannel(colyseus);
  await testDoubleLoginCrossChannel(colyseus);
  await testTransferIsNotDoubleLogin(colyseus);
  await testCrossMapTransferIsNotDoubleLogin(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[singleSession] PASS ✔  all single-session guard tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[singleSession] FAIL ✘", err);
  process.exit(1);
});
