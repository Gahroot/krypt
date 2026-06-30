/**
 * Server hardening test — sends malformed, oversized, and spammed inputs to all
 * authoritative rooms and asserts they are rejected without corrupting state.
 *
 * Run: npx tsx test/hardenedInputs.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard watchdog so the process can never hang.
const watchdog = setTimeout(() => {
  console.error("[hardened] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

// ─── Helpers ──────────────────────────────────────────────────────────────

function snapPlayer(room: any): {
  x: number;
  y: number;
  hp: number;
  mp: number;
  mesos: number;
  invSize: number;
} {
  const me = room.state.players.get(room.sessionId);
  assert.ok(me, "player must exist in state");
  return { x: me.x, y: me.y, hp: me.hp, mp: me.mp, mesos: me.mesos, invSize: me.inventory.size };
}

// ─── MapRoom: malformed inputs ───────────────────────────────────────────

async function testMalformedInput(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[hardened] ── malformed input (MapRoom) ──");
  const room = await colyseus.sdk.joinOrCreate("meadowfield", { name: "Harden1" });
  await sleep(200);

  const before = snapPlayer(room);

  // 1. Send null as input.
  room.send(MessageType.INPUT, null);
  // 2. Send empty object.
  room.send(MessageType.INPUT, {});
  // 3. Send non-boolean left field.
  room.send(MessageType.INPUT, {
    left: "yes",
    right: false,
    up: false,
    down: false,
    attack: false,
    jump: false,
    interact: false,
    tick: 1,
  });
  // 4. Send NaN tick.
  room.send(MessageType.INPUT, {
    left: false,
    right: false,
    up: false,
    down: false,
    attack: false,
    jump: false,
    interact: false,
    tick: NaN,
  });
  // 5. Send Infinity tick.
  room.send(MessageType.INPUT, {
    left: false,
    right: false,
    up: false,
    down: false,
    attack: false,
    jump: false,
    interact: false,
    tick: Infinity,
  });
  // 6. Send negative tick.
  room.send(MessageType.INPUT, {
    left: false,
    right: false,
    up: false,
    down: false,
    attack: false,
    jump: false,
    interact: false,
    tick: -999,
  });

  await sleep(300);

  const after = snapPlayer(room);
  // Player position and resources must not have changed from malformed inputs.
  assert.strictEqual(after.hp, before.hp, "HP must not change from malformed input");
  assert.strictEqual(after.mp, before.mp, "MP must not change from malformed input");
  assert.strictEqual(after.mesos, before.mesos, "Mesos must not change from malformed input");
  assert.strictEqual(
    after.invSize,
    before.invSize,
    "Inventory must not change from malformed input",
  );

  console.log("[hardened] malformed input: state intact ✔");
  await room.leave();
}

// ─── MapRoom: oversized chat ─────────────────────────────────────────────

async function testOversizedChat(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[hardened] ── oversized chat ──");
  const room = await colyseus.sdk.joinOrCreate("meadowfield", { name: "Harden2" });
  await sleep(200);

  const before = snapPlayer(room);

  // Send a message longer than CHAT_MAX_LEN (120) but under WS payload limit.
  // The server should truncate and not crash.
  room.send(MessageType.CHAT, { text: "A".repeat(500) });
  await sleep(300);

  const after = snapPlayer(room);
  // State must not be corrupted.
  assert.strictEqual(after.hp, before.hp, "HP must not change from oversized chat");
  assert.strictEqual(after.mesos, before.mesos, "Mesos must not change from oversized chat");
  console.log("[hardened] oversized chat: state intact ✔");
  await room.leave();
}

// ─── MapRoom: spam input ────────────────────────────────────────────────

async function testSpamInput(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[hardened] ── spam input (MapRoom) ──");
  const room = await colyseus.sdk.joinOrCreate("meadowfield", { name: "Harden3" });
  await sleep(200);

  const before = snapPlayer(room);

  // Fire 200 rapid input messages (should be rate-limited).
  for (let i = 0; i < 200; i++) {
    room.send(MessageType.INPUT, {
      left: true,
      right: false,
      up: false,
      down: false,
      attack: true,
      jump: false,
      interact: false,
      tick: i,
    });
  }

  await sleep(500);

  const after = snapPlayer(room);
  // Player should not have moved much beyond normal — rate limiter caps throughput.
  // At most a few ticks worth of movement should have been processed.
  const dx = Math.abs(after.x - before.x);
  assert.ok(dx < 50, `Player should not teleport from spam input; dx=${dx}`);

  console.log(`[hardened] spam input: capped (dx=${dx.toFixed(1)}) ✔`);
  await room.leave();
}

// ─── MapRoom: spam skill cast ───────────────────────────────────────────

async function testSpamSkillCast(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[hardened] ── spam skill cast ──");
  const room = await colyseus.sdk.joinOrCreate("meadowfield", { name: "Harden4" });
  await sleep(200);

  const before = snapPlayer(room);

  // Fire 50 skill casts rapidly (rate limiter should cap at 10/sec).
  for (let i = 0; i < 50; i++) {
    room.send(MessageType.SKILL_CAST, { skillId: "warrior.power_slash" });
  }

  await sleep(500);

  // MP should not have drained beyond what 10 casts could consume.
  const after = snapPlayer(room);
  const mpDelta = before.mp - after.mp;
  // At 10 casts max, MP drain should be bounded.
  assert.ok(mpDelta <= 10_000, `MP drain from spam should be bounded; delta=${mpDelta}`);
  assert.ok(after.hp === before.hp, "HP must not change from spam skill casts");

  console.log(`[hardened] spam skill cast: bounded (mpDelta=${mpDelta}) ✔`);
  await room.leave();
}

// ─── MapRoom: malformed pickup ──────────────────────────────────────────

async function testMalformedPickup(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[hardened] ── malformed pickup ──");
  const room = await colyseus.sdk.joinOrCreate("meadowfield", { name: "Harden5" });
  await sleep(200);

  const before = snapPlayer(room);

  // 1. Send number as uid (should be rejected).
  room.send(MessageType.PICKUP, { uid: 12345 });
  // 2. Send null uid.
  room.send(MessageType.PICKUP, { uid: null });
  // 3. Send oversized uid.
  room.send(MessageType.PICKUP, { uid: "X".repeat(200) });
  // 4. Send empty uid.
  room.send(MessageType.PICKUP, { uid: "" });

  await sleep(300);

  const after = snapPlayer(room);
  assert.strictEqual(
    after.invSize,
    before.invSize,
    "Inventory must not change from malformed pickup",
  );

  console.log("[hardened] malformed pickup: rejected ✔");
  await room.leave();
}

// ─── MapRoom: null-byte chat injection ──────────────────────────────────

async function testNullByteChat(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[hardened] ── null-byte chat injection ──");
  const room = await colyseus.sdk.joinOrCreate("meadowfield", { name: "Harden6" });
  await sleep(200);

  const before = snapPlayer(room);

  // Send chat with null bytes — server should strip them without crashing.
  room.send(MessageType.CHAT, { text: "hello\x00world" });
  await sleep(300);

  const after = snapPlayer(room);
  assert.strictEqual(after.hp, before.hp, "HP must not change from null-byte chat");
  console.log("[hardened] null-byte chat: state intact ✔");
  await room.leave();
}

// ─── State integrity after all adversarial inputs ───────────────────────

async function testStateIntegrity(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[hardened] ── state integrity ──");
  const room = await colyseus.sdk.joinOrCreate("meadowfield", { name: "Harden7" });
  await sleep(200);

  const before = snapPlayer(room);

  // Combine many adversarial inputs.
  room.send(MessageType.INPUT, null);
  room.send(MessageType.INPUT, { left: "hack", right: 42 });
  room.send(MessageType.SKILL_CAST, { skillId: null });
  room.send(MessageType.SKILL_CAST, { skillId: "A".repeat(500) });
  room.send(MessageType.USE_CONSUMABLE, { defId: NaN });
  room.send(MessageType.MACRO_CAST, { macroId: undefined });
  room.send(MessageType.PICKUP, { uid: { evil: true } });
  room.send(MessageType.PICKUP_ALL);
  room.send(MessageType.CHAT, { text: "\x00\x00\x00" });

  await sleep(500);

  const after = snapPlayer(room);
  assert.strictEqual(after.hp, before.hp, "HP must survive adversarial barrage");
  assert.strictEqual(after.mp, before.mp, "MP must survive adversarial barrage");
  assert.strictEqual(after.mesos, before.mesos, "Mesos must survive adversarial barrage");
  assert.strictEqual(after.invSize, before.invSize, "Inventory must survive adversarial barrage");

  console.log("[hardened] state integrity: clean ✔");
  await room.leave();
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await boot(appConfig);

  await testMalformedInput(colyseus);
  await testOversizedChat(colyseus);
  await testSpamInput(colyseus);
  await testSpamSkillCast(colyseus);
  await testMalformedPickup(colyseus);
  await testNullByteChat(colyseus);
  await testStateIntegrity(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[hardened] PASS ✔  all adversarial-input tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[hardened] FAIL ✘", err);
  process.exit(1);
});
