/**
 * Friends list + whisper integration test.
 * Boots rooms in-process via @colyseus/testing, joins two players,
 * and verifies: friend add, online-status broadcast on join/leave,
 * whisper delivery, and whisper failure for offline targets.
 *
 * Run: npx tsx test/friends.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard watchdog so the process can never hang.
const watchdog = setTimeout(() => {
  console.error("[friends] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Collect messages for a given MessageType from a room. */
function collectMessages<T>(room: any, type: number): T[] {
  const messages: T[] = [];
  room.onMessage(type, (msg: T) => {
    messages.push(msg);
  });
  return messages;
}

// ─── Test: friend add + online status ─────────────────────────────────────────

async function testFriendAdd(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[friends] ── friend add + online status ──");

  const ts = String(Date.now()).slice(-6);
  // Join Alice first (she'll be alone initially).
  const alice = await colyseus.sdk.joinOrCreate("meadowfield", { name: `Al${ts}` });
  await sleep(200);
  const aliceId = alice.sessionId;
  const aliceMe = () => (alice.state as any).players.get(aliceId);
  assert.ok(aliceMe(), "Alice should exist in state");
  console.log(`[friends] Alice joined: ${aliceMe().name}`);

  // Collect messages for Alice.
  const aliceFriendList = collectMessages<{ friends: any[] }>(alice, MessageType.FRIEND_LIST);
  const aliceResult = collectMessages<{ success: boolean; message: string }>(
    alice,
    MessageType.FRIEND_RESULT,
  );
  collectMessages<{
    updates: { charId: string; name: string; online: boolean }[];
  }>(alice, MessageType.ONLINE_STATUS);

  // Join Bob.
  const bob = await colyseus.sdk.joinOrCreate("meadowfield", { name: `Bob${ts}` });
  await sleep(300);
  const bobId = bob.sessionId;
  const bobMe = () => (bob.state as any).players.get(bobId);
  assert.ok(bobMe(), "Bob should exist in state");
  console.log(`[friends] Bob joined: ${bobMe().name}`);

  // Collect messages for Bob.
  const bobFriendList = collectMessages<{ friends: any[] }>(bob, MessageType.FRIEND_LIST);
  const bobResult = collectMessages<{ success: boolean; message: string }>(
    bob,
    MessageType.FRIEND_RESULT,
  );
  collectMessages<{
    updates: { charId: string; name: string; online: boolean }[];
  }>(bob, MessageType.ONLINE_STATUS);

  // Alice sends a friend request to Bob.
  alice.send(MessageType.FRIEND_ADD, { targetName: `Bob${ts}` });
  await sleep(300);

  // Verify Alice got a success result.
  const aliceLastResult = aliceResult[aliceResult.length - 1];
  assert.ok(aliceLastResult, "Alice should receive a FRIEND_RESULT");
  assert.strictEqual(
    aliceLastResult.success,
    true,
    `Alice friend-add should succeed: ${aliceLastResult.message}`,
  );
  console.log(`[friends] Alice friend-add result: ${aliceLastResult.message}`);

  // Verify Alice's friend list now contains Bob.
  const aliceLastList = aliceFriendList[aliceFriendList.length - 1];
  assert.ok(aliceLastList, "Alice should receive a FRIEND_LIST");
  assert.ok(
    aliceLastList.friends.some((f: any) => f.name === `Bob${ts}`),
    "Alice's friends list should contain Bob",
  );
  console.log(
    `[friends] Alice friend list: ${aliceLastList.friends.map((f: any) => f.name).join(", ")}`,
  );

  // Verify Bob got a notification that Alice added him.
  const bobLastResult = bobResult[bobResult.length - 1];
  assert.ok(bobLastResult, "Bob should receive a FRIEND_RESULT from Alice's add");
  assert.strictEqual(
    bobLastResult.success,
    true,
    `Bob should be notified: ${bobLastResult.message}`,
  );
  console.log(`[friends] Bob notification: ${bobLastResult.message}`);

  // Verify Bob's friend list now contains Alice.
  const bobLastList = bobFriendList[bobFriendList.length - 1];
  assert.ok(bobLastList, "Bob should receive a FRIEND_LIST");
  assert.ok(
    bobLastList.friends.some((f: any) => f.name === `Al${ts}`),
    "Bob's friends list should contain Alice",
  );
  console.log(
    `[friends] Bob friend list: ${bobLastList.friends.map((f: any) => f.name).join(", ")}`,
  );

  // Verify Alice shows as online in Bob's friend list.
  const aliceEntry = bobLastList.friends.find((f: any) => f.name === `Al${ts}`);
  assert.ok(aliceEntry, "Bob should see Alice in friend list");
  assert.strictEqual(aliceEntry.online, true, "Alice should show as online to Bob");
  console.log(`[friends] Alice online status in Bob's list: ${aliceEntry.online}`);

  // Clean up: both leave.
  await alice.leave();
  await sleep(200);
  await bob.leave();
  await sleep(200);
}

// ─── Test: online status on join/leave ────────────────────────────────────────

async function testOnlineStatus(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[friends] ── online status join/leave ──");

  const ts2 = String(Date.now()).slice(-6);
  // Join Alice.
  const alice = await colyseus.sdk.joinOrCreate("meadowfield", { name: `Sa${ts2}` });
  await sleep(200);

  // Join Bob.
  const bob = await colyseus.sdk.joinOrCreate("meadowfield", { name: `Sb${ts2}` });
  await sleep(300);

  // Make them friends.
  alice.send(MessageType.FRIEND_ADD, { targetName: `Sb${ts2}` });
  await sleep(300);

  // Clear collected messages for the leave test.
  const aliceStatus: any[] = [];
  alice.onMessage(MessageType.ONLINE_STATUS, (msg: any) => {
    aliceStatus.push(msg);
  });

  // Bob leaves — Alice should get an offline status update.
  await bob.leave();
  await sleep(400);

  const offlineUpdate = aliceStatus.find((u) =>
    u.updates.some((upd: any) => upd.name === `Sb${ts2}` && upd.online === false),
  );
  assert.ok(offlineUpdate, "Alice should receive an ONLINE_STATUS update with Bob offline");
  console.log("[friends] Alice received Bob-offline status update ✓");

  // Charlie joins as a new friend of Alice — Alice should get an online status update.
  const charlie = await colyseus.sdk.joinOrCreate("meadowfield", { name: `Sc${ts2}` });
  await sleep(300);
  alice.send(MessageType.FRIEND_ADD, { targetName: `Sc${ts2}` });
  await sleep(400);

  const onlineUpdate = aliceStatus.find((u) =>
    u.updates.some((upd: any) => upd.name === `Sc${ts2}` && upd.online === true),
  );
  assert.ok(onlineUpdate, "Alice should receive an ONLINE_STATUS update with Charlie online");
  console.log("[friends] Alice received Charlie-online status update ✓");

  // Clean up.
  await alice.leave();
  await sleep(200);
  await charlie.leave();
  await sleep(200);
}

// ─── Test: whisper delivery + offline failure ─────────────────────────────────

async function testWhisper(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[friends] ── whisper delivery + offline failure ──");

  const ts3 = String(Date.now()).slice(-6);
  // Join Alice.
  const alice = await colyseus.sdk.joinOrCreate("meadowfield", { name: `Wa${ts3}` });
  await sleep(200);

  // Join Bob.
  const bob = await colyseus.sdk.joinOrCreate("meadowfield", { name: `Wb${ts3}` });
  await sleep(300);

  // Collect whisper messages on Bob's side.
  const bobWhispers: any[] = [];
  bob.onMessage(MessageType.WHISPER_RELAY, (msg: any) => {
    bobWhispers.push(msg);
  });

  // Collect whisper-failed on Alice's side.
  const aliceFailed: any[] = [];
  alice.onMessage(MessageType.WHISPER_FAILED, (msg: any) => {
    aliceFailed.push(msg);
  });

  // Collect chat confirm on Alice's side.
  const aliceChat: any[] = [];
  alice.onMessage(MessageType.CHAT, (msg: any) => {
    aliceChat.push(msg);
  });

  // Alice whispers Bob.
  alice.send(MessageType.WHISPER, { targetName: `Wb${ts3}`, text: "Hello Bob!" });
  await sleep(300);

  // Verify Bob received the whisper.
  assert.ok(bobWhispers.length > 0, "Bob should receive a whisper");
  const whisper = bobWhispers[bobWhispers.length - 1];
  assert.ok(
    whisper.senderName.startsWith("Wa"),
    `Whisper sender should be Alice, got ${whisper.senderName}`,
  );
  assert.strictEqual(whisper.text, "Hello Bob!", "Whisper text should match");
  console.log(`[friends] Bob received whisper from ${whisper.senderName}: "${whisper.text}" ✓`);

  // Verify Alice got a chat confirmation (echo).
  const confirm = aliceChat.find((m) => m.name === "Whisper" && m.text.includes(`Wb${ts3}`));
  assert.ok(confirm, "Alice should see a whisper confirmation in chat");
  console.log("[friends] Alice received whisper confirmation ✓");

  // Alice whispers a nonexistent player — should fail.
  alice.send(MessageType.WHISPER, { targetName: "NobodyHere", text: "test" });
  await sleep(300);

  assert.ok(aliceFailed.length > 0, "Alice should receive a WHISPER_FAILED");
  const fail = aliceFailed[aliceFailed.length - 1];
  assert.strictEqual(fail.targetName, "NobodyHere");
  assert.ok(fail.reason.length > 0, "Failure reason should be non-empty");
  console.log(`[friends] Alice whisper to offline: "${fail.reason}" ✓`);

  // Clean up.
  await alice.leave();
  await sleep(200);
  await bob.leave();
  await sleep(200);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testFriendAdd(colyseus);
  await testOnlineStatus(colyseus);
  await testWhisper(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[friends] PASS ✔  all friend + whisper tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[friends] FAIL ✘", err);
  process.exit(1);
});
