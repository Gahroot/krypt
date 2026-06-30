/**
 * Server hardening test — sends malformed, oversized, and spammed inputs to all
 * authoritative rooms and asserts they are rejected without corrupting state.
 *
 * It also covers IDENTITY SPOOFING: every handler that acts on a charId/accountId
 * must resolve the actor from the authenticated session (client.auth), never from
 * the message payload. The crafted-message tests below claim to be another account
 * (join with someone else's charId, fire a GM command without the admin role, cancel
 * a stranger's market listing, fame a non-existent target) and assert the server
 * rejects the claim.
 *
 * Run: npx tsx test/hardenedInputs.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore, marketStore } from "../src/persistence/store";
import { randomizeAppearance } from "@maple/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolve with the first message of `msgType`, or reject after `timeoutMs`. */
function waitForMessage<T>(
  room: { onMessage: (type: number, cb: (msg: T) => void) => void },
  msgType: number,
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for message type ${msgType}`)),
      timeoutMs,
    );
    room.onMessage(msgType, (msg: T) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

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

async function testMalformedInput(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
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

async function testOversizedChat(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
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

async function testSpamInput(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
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

async function testSpamSkillCast(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
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

async function testMalformedPickup(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
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

async function testNullByteChat(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
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

async function testStateIntegrity(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
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

// ─── Identity spoofing: actor must come from the session, never the payload ──
//
// The trust model (see AuthedRoom / auth.ts): `client.auth.accountId` is the only
// trusted identity. Every handler resolves the ACTOR from the session (sessionId →
// player/charId/accountId) and accepts only the TARGET from the message payload.
// These tests craft messages that claim to be another account and assert the server
// ignores the claim.

let spoofSeq = 0;
function freshAccount(prefix: string): string {
  const id = `acct_spoof_${prefix}_${++spoofSeq}_${Date.now().toString(36)}`;
  accountStore.getOrCreate(id);
  return id;
}

/** Character names are globally UNIQUE in the DB — keep them collision-free per run. */
function freshName(prefix: string): string {
  return `${prefix}${(++spoofSeq).toString(36)}${Date.now().toString(36).slice(-4)}`.slice(0, 16);
}

// ─── MapRoom.onJoin: options.charId / options.accountId cannot load another
//      account's character ──────────────────────────────────────────────────

async function testCharIdSpoofRejected(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[hardened] ── charId/accountId join spoof (MapRoom) ──");

  const victimAcct = freshAccount("victim");
  const attackerAcct = freshAccount("attacker");
  const victimChar = accountStore.createCharacter(victimAcct, {
    name: freshName("SpfVic"),
    archetype: "WARRIOR",
    appearance: randomizeAppearance(() => 0.11),
  });
  const attackerChar = accountStore.createCharacter(attackerAcct, {
    name: freshName("SpfAtk"),
    archetype: "MAGE",
    appearance: randomizeAppearance(() => 0.22),
  });

  // Attacker authenticates as itself (explicit accountId → token bound to attacker),
  // but tries to load the VICTIM's character and claim the victim's accountId via the
  // join payload — the exact crafted-message attack the audit guards against.
  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    accountId: attackerAcct,
    charId: victimChar.charId,
  });
  await sleep(300);

  const me = (room.state as any).players.get(room.sessionId);
  assert.ok(me, "attacker must have a player in state");
  // The server must have ignored the spoofed charId/accountId and loaded the
  // attacker's OWN character, derived from the verified token identity.
  assert.notStrictEqual(
    me.charId,
    victimChar.charId,
    "server must NOT load another account's character from options.charId",
  );
  assert.strictEqual(me.charId, attackerChar.charId, "server must load the attacker's own char");
  // The resolved character must be owned by the AUTHENTICATED account (client.auth),
  // not the accountId the client supplied in the join payload. (`Player.accountId` is a
  // server-only field and is not synced to the client, so assert via the durable store.)
  assert.strictEqual(
    accountStore.getCharacter(me.charId)?.accountId,
    attackerAcct,
    "loaded character must belong to the authenticated account, not options.accountId",
  );
  // The victim's character is untouched and still owned by the victim.
  assert.strictEqual(
    accountStore.getCharacter(victimChar.charId)?.accountId,
    victimAcct,
    "victim character ownership must be unchanged",
  );

  console.log("[hardened] charId/accountId join spoof: rejected ✔");
  await room.leave();
}

// ─── GM commands: authority comes from accountStore role, never a client claim ──

async function testGmRoleFromDb(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[hardened] ── GM command role gate (accountStore) ──");

  const acct = freshAccount("gm");
  const char = accountStore.createCharacter(acct, {
    name: freshName("NotAdmin"),
    archetype: "THIEF",
    appearance: randomizeAppearance(() => 0.33),
  });
  accountStore.setMesos(char.charId, 1000);
  assert.strictEqual(accountStore.getAccount(acct)?.role, "player", "account starts as player");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    accountId: acct,
    charId: char.charId,
  });
  await sleep(250);

  // A non-admin firing a GM command must be denied — the client cannot self-claim
  // admin; the role is read from the DB server-side.
  const denied = waitForMessage<{ success: boolean; message: string }>(
    room as any,
    MessageType.GM_RESULT,
  );
  room.send(MessageType.GM_COMMAND, { command: "/give mesos 5000000" });
  const deniedResult = await denied;
  await sleep(150);

  assert.strictEqual(deniedResult.success, false, "non-admin GM command must be denied");
  assert.match(deniedResult.message, /admin/i, "denial should cite the admin role requirement");
  assert.strictEqual(
    accountStore.getCharacter(char.charId)?.mesos,
    1000,
    "denied GM command must not mutate mesos",
  );

  // Promote the account in the DB and retry — proving the gate reads accountStore,
  // not any value the client supplied.
  accountStore.setRole(acct, "admin");
  const allowed = waitForMessage<{ success: boolean; message: string }>(
    room as any,
    MessageType.GM_RESULT,
  );
  room.send(MessageType.GM_COMMAND, { command: "/give mesos 5000000" });
  const allowedResult = await allowed;
  await sleep(200);

  assert.strictEqual(allowedResult.success, true, "admin GM command must succeed after DB promote");
  assert.ok(
    (accountStore.getCharacter(char.charId)?.mesos ?? 0) > 1000,
    "admin GM command should apply once the DB role is admin",
  );

  console.log("[hardened] GM command role gate: enforced from DB ✔");
  await room.leave();
}

// ─── MarketRoom: a non-owner cannot cancel another character's listing ──────

async function testMarketCrossAccountCancel(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[hardened] ── market cross-account cancel ──");

  const victimAcct = freshAccount("mkt_victim");
  const attackerAcct = freshAccount("mkt_attacker");
  const victim = accountStore.createCharacter(victimAcct, {
    name: freshName("MktVic"),
    archetype: "WARRIOR",
    appearance: randomizeAppearance(() => 0.44),
  });
  const attacker = accountStore.createCharacter(attackerAcct, {
    name: freshName("MktAtk"),
    archetype: "ARCHER",
    appearance: randomizeAppearance(() => 0.55),
  });

  // Victim has a permit + an item, and lists it (escrow).
  accountStore.addItem(victim.charId, {
    uid: "spoof_permit",
    defId: "cash.store_permit",
    baseRank: "NORMAL",
    potentialTier: "NONE",
    lines: 0,
    minted: false,
  });
  accountStore.addItem(victim.charId, {
    uid: "spoof_listing_item",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "EPIC",
    lines: 2,
    minted: false,
  });

  const victimClient = await colyseus.sdk.joinOrCreate("market_room", { charId: victim.charId });
  await sleep(200);
  victimClient.send("list", { itemUid: "spoof_listing_item", price: 777 });
  await sleep(300);

  const listing = marketStore.all().find((l) => l.sellerId === victim.charId);
  assert.ok(listing, "victim listing should exist");
  const listingId = listing!.listingId;

  // Attacker joins and tries to cancel the VICTIM's listing by its id.
  const attackerClient = await colyseus.sdk.joinOrCreate("market_room", {
    charId: attacker.charId,
  });
  await sleep(200);
  attackerClient.send("cancel", { listingId });
  await sleep(300);

  // The listing must still be on the book and the escrowed item must NOT have
  // leaked to the attacker.
  assert.ok(marketStore.get(listingId), "non-owner must not be able to cancel the listing");
  assert.strictEqual(
    accountStore.getItem(attacker.charId, "spoof_listing_item"),
    undefined,
    "escrowed item must not transfer to a non-owner canceller",
  );

  console.log("[hardened] market cross-account cancel: rejected ✔");
  await attackerClient.leave();
  await victimClient.leave();
}

// ─── GIVE_FAME: the target must be resolved + validated (cannot fame a ghost) ──

async function testFameTargetValidated(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[hardened] ── fame target validation ──");

  const acct = freshAccount("fame");
  const char = accountStore.createCharacter(acct, {
    name: freshName("FameGvr"),
    archetype: "WARRIOR",
    appearance: randomizeAppearance(() => 0.66),
  });
  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    accountId: acct,
    charId: char.charId,
  });
  await sleep(250);

  // Target a charId that is not present/online — the handler must reject rather
  // than acting on an unvalidated payload-supplied identity.
  const result = waitForMessage<{ success: boolean; message: string }>(
    room as any,
    MessageType.FAME_RESULT,
  );
  room.send(MessageType.GIVE_FAME, { targetCharId: "char_does_not_exist_xyz", amount: 1 });
  const fameResult = await result;
  await sleep(150);

  assert.strictEqual(fameResult.success, false, "fame to a non-existent target must fail");
  assert.match(fameResult.message, /not found/i, "should report the target was not found");

  console.log("[hardened] fame target validation: enforced ✔");
  await room.leave();
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testMalformedInput(colyseus);
  await testOversizedChat(colyseus);
  await testSpamInput(colyseus);
  await testSpamSkillCast(colyseus);
  await testMalformedPickup(colyseus);
  await testNullByteChat(colyseus);
  await testStateIntegrity(colyseus);
  await testCharIdSpoofRejected(colyseus);
  await testGmRoleFromDb(colyseus);
  await testMarketCrossAccountCancel(colyseus);
  await testFameTargetValidated(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[hardened] PASS ✔  all adversarial-input tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[hardened] FAIL ✘", err);
  process.exit(1);
});
