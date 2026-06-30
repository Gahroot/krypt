/**
 * Channel system test — proves joining a specific channel, switching channels while
 * preserving character state, and cross-channel whisper delivery.
 *
 * Run: npx tsx test/channels.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";
import { channelRegistry } from "../src/channelRegistry";
import type { ChannelSwitchResultPayload, WhisperRelayPayload } from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[channels] FAIL ✘ watchdog timeout");
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

// ─── Test 1: Join a specific channel, verify channel list ─────────────────

async function testJoinChannel(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[channels] ── join channel 0 ──");

  const acct = `ch_join_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "ChannelHero",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  accountStore.setMesos(rec.charId, 5000);

  // Join via the channel-named room.
  const room = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(200);

  const sessionId = room.sessionId;
  const me = () => (room.state as any).players.get(sessionId);
  assert.ok(me(), "player should exist in channel 0 after join");
  assert.strictEqual((room.state as any).mapId, "meadowfield", "mapId should be meadowfield");

  // Verify mesos were preserved from the character record.
  assert.strictEqual(me().mesos, 5000, "mesos should be 5000 from the character record");
  assert.strictEqual(me().name, "ChannelHero", "name should be ChannelHero");

  console.log("[channels] ✔ joined channel 0 with preserved state");
  await room.leave();
}

// ─── Test 2: Switch channels, verify state preservation ───────────────────

async function testChannelSwitch(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[channels] ── switch channel ──");

  const acct = `ch_switch_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "Switcher",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  accountStore.setMesos(rec.charId, 12345);

  // Join channel 0.
  const room0 = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec.charId,
    accountId: acct,
  });
  await sleep(200);

  const sessionId0 = room0.sessionId;
  const me0 = () => (room0.state as any).players.get(sessionId0);
  assert.ok(me0(), "player should be in channel 0");
  assert.strictEqual(me0().mesos, 12345, "mesos should be 12345 in ch0");

  // Listen for CHANNEL_SWITCH_RESULT.
  let switchResult: ChannelSwitchResultPayload | null = null;
  room0.onMessage(MessageType.CHANNEL_SWITCH_RESULT, (msg: ChannelSwitchResultPayload) => {
    switchResult = msg;
  });

  // Request channel switch to ch1.
  room0.send(MessageType.CHANNEL_SWITCH, { channel: 1 });
  await sleep(500);

  assert.ok(switchResult, "should receive CHANNEL_SWITCH_RESULT");
  assert.strictEqual(switchResult!.channel, 1, "target channel should be 1");
  assert.strictEqual(switchResult!.mapId, "meadowfield", "mapId should be meadowfield");

  // Leave ch0 and join ch1.
  await room0.leave();
  await sleep(200);

  const room1 = await colyseus.sdk.joinOrCreate("meadowfield__ch1", {
    charId: rec.charId,
    accountId: acct,
    spawnId: switchResult!.spawnId,
  });
  await sleep(200);

  const sessionId1 = room1.sessionId;
  const me1 = () => (room1.state as any).players.get(sessionId1);
  assert.ok(me1(), "player should exist in channel 1");

  // Verify character state was preserved across the channel switch.
  assert.strictEqual(me1().mesos, 12345, "mesos should be 12345 after switch to ch1");
  assert.strictEqual(me1().name, "Switcher", "name should be preserved");
  assert.strictEqual(me1().level, 1, "level should be preserved");

  console.log("[channels] ✔ switched ch0 → ch1, state preserved (mesos=12345)");
  await room1.leave();
}

// ─── Test 3: Cross-channel whisper ────────────────────────────────────────

async function testCrossChannelWhisper(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[channels] ── cross-channel whisper ──");

  const acct1 = `ch_wisp1_${Date.now()}`;
  const acct2 = `ch_wisp2_${Date.now()}`;
  const rec1 = accountStore.createCharacter(acct1, {
    name: "Whisperer",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const rec2 = accountStore.createCharacter(acct2, {
    name: "Listener",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  // Player 1 joins channel 0, player 2 joins channel 1.
  const room0 = await colyseus.sdk.joinOrCreate("meadowfield__ch0", {
    charId: rec1.charId,
    accountId: acct1,
  });
  await sleep(100);
  const room1 = await colyseus.sdk.joinOrCreate("meadowfield__ch1", {
    charId: rec2.charId,
    accountId: acct2,
  });
  await sleep(300);

  // Set up whisper listener on player 2 (channel 1).
  let whisperReceived: WhisperRelayPayload | null = null;
  room1.onMessage(MessageType.WHISPER_RELAY, (msg: WhisperRelayPayload) => {
    whisperReceived = msg;
  });

  // Player 1 whispers to player 2 (cross-channel). Use filter-clean text so the
  // server's profanity filter (which the whisper path legitimately applies)
  // doesn't censor it — this test verifies cross-channel delivery, not filtering.
  const whisperText = "Greetings from ch0!";
  room0.send(MessageType.WHISPER, { targetName: "Listener", text: whisperText });
  await sleep(300);

  assert.ok(whisperReceived, "Player 2 should have received the whisper");
  assert.strictEqual(whisperReceived!.senderName, "Whisperer", "sender should be Whisperer");
  assert.strictEqual(whisperReceived!.text, whisperText, "text should match");

  // Verify the channel registry is tracking both players.
  assert.strictEqual(channelRegistry.totalOnline, 2, "should have 2 online players");
  const found = channelRegistry.findByName("Listener");
  assert.ok(found, "findByName('Listener') should find the target");
  assert.strictEqual(found!.channel, 1, "Listener should be on channel 1");
  assert.strictEqual(found!.mapId, "meadowfield", "Listener should be on meadowfield");

  console.log("[channels] ✔ cross-channel whisper delivered (ch0 → ch1)");
  await room1.leave();
  await room0.leave();
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testJoinChannel(colyseus);
  await testChannelSwitch(colyseus);
  await testCrossChannelWhisper(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[channels] PASS ✔  all channel tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[channels] FAIL ✘", err);
  process.exit(1);
});
