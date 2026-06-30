/**
 * Guild system test — proves create→invite→accept→roster persistence,
 * rank-permission check (only master/officer can invite), guild chat relay,
 * and leave/kick/rank-change.
 *
 * Run: npx tsx test/guild.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";
import { guildManager, GUILD_CREATE_COST } from "../src/guildManager";
import type {
  GuildUpdatePayload,
  GuildInviteReceivedPayload,
  GuildResultPayload,
  GuildChatRelayPayload,
} from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[guild] FAIL ✘ watchdog timeout");
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

// ─── Test 1: Create a guild ─────────────────────────────────────────────

async function testCreateGuild(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[guild] ── create guild ──");

  const acct1 = `guild_create_${Date.now()}`;
  const rec1 = accountStore.createCharacter(acct1, {
    name: "GuildMaster",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  // Give enough mesos to create a guild.
  accountStore.setMesos(rec1.charId, 100_000);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk1 = await colyseus.connectTo(serverRoom, {
    charId: rec1.charId,
    accountId: acct1,
  });
  sdk1.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  // Listen for guild result.
  let resultPayload: GuildResultPayload | null = null;
  sdk1.onMessage(MessageType.GUILD_RESULT, (msg: GuildResultPayload) => {
    resultPayload = msg;
  });

  // Create the guild.
  sdk1.send(MessageType.GUILD_CREATE, { name: "TestGuild", color: 0xff0000 });
  await sleep(300);

  assert.ok(resultPayload, "Should receive a guild result");
  assert.strictEqual(resultPayload!.success, true, "Guild creation should succeed");
  assert.ok(
    resultPayload!.message.includes("TestGuild"),
    "Result message should mention guild name",
  );

  // Verify the guild exists in the guild manager.
  const guild = guildManager.getGuildForChar(rec1.charId);
  assert.ok(guild, "Guild should exist");
  assert.strictEqual(guild!.name, "TestGuild");
  assert.strictEqual(guild!.emblem.color, 0xff0000);
  assert.strictEqual(guild!.roster.size, 1, "Guild should have 1 member");
  assert.strictEqual(guild!.roster.get(rec1.charId), "master", "Creator should be master");

  // Verify the player's mesos were deducted.
  const p1 = serverRoom.state.players.get(sdk1.sessionId)!;
  assert.ok(p1.mesos < 100_000, "Mesos should be deducted");
  assert.strictEqual(
    p1.mesos,
    100_000 - GUILD_CREATE_COST,
    "Mesos should equal start minus guild cost",
  );

  console.log("[guild] ✔ guild created with master");

  await sdk1.leave();
}

// ─── Test 2: Invite → Accept → Roster persistence ───────────────────────

async function testInviteAcceptRoster(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[guild] ── invite → accept → roster ──");

  const acct1 = `guild_inv1_${Date.now()}`;
  const acct2 = `guild_inv2_${Date.now()}`;
  const rec1 = accountStore.createCharacter(acct1, {
    name: "GuildA",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const rec2 = accountStore.createCharacter(acct2, {
    name: "GuildB",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  accountStore.setMesos(rec1.charId, 100_000);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk1 = await colyseus.connectTo(serverRoom, {
    charId: rec1.charId,
    accountId: acct1,
  });
  sdk1.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  const sdk2 = await colyseus.connectTo(serverRoom, {
    charId: rec2.charId,
    accountId: acct2,
  });
  sdk2.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  // Player 1 creates the guild.
  let createResult: GuildResultPayload | null = null;
  sdk1.onMessage(MessageType.GUILD_RESULT, (msg: GuildResultPayload) => {
    createResult = msg;
  });
  sdk1.send(MessageType.GUILD_CREATE, { name: "InviteGuild", color: 0x00ff00 });
  await sleep(300);
  assert.ok(createResult?.success, "Guild creation should succeed");

  // Player 1 invites Player 2.
  let inviteReceived = false;
  let invitePayload: GuildInviteReceivedPayload | null = null;
  sdk2.onMessage(MessageType.GUILD_INVITE_RECEIVED, (msg: GuildInviteReceivedPayload) => {
    inviteReceived = true;
    invitePayload = msg;
  });

  sdk1.send(MessageType.GUILD_INVITE, { targetSessionId: sdk2.sessionId });
  await sleep(300);

  assert.ok(inviteReceived, "Player 2 should have received a guild invite");
  assert.ok(invitePayload, "Invite payload should exist");
  assert.strictEqual(invitePayload!.fromName, "GuildA");

  // Player 2 accepts.
  let acceptUpdate: GuildUpdatePayload | null = null;
  sdk2.onMessage(MessageType.GUILD_UPDATE, (msg: GuildUpdatePayload) => {
    acceptUpdate = msg;
  });

  sdk2.send(MessageType.GUILD_ACCEPT, { fromSessionId: sdk1.sessionId });
  await sleep(300);

  // Both should now have guild state.
  assert.ok(acceptUpdate, "Player 2 should have received a guild update");
  assert.ok(acceptUpdate!.guildId, "Guild should have an id");
  assert.strictEqual(acceptUpdate!.guildName, "InviteGuild");
  assert.strictEqual(acceptUpdate!.members.length, 2, "Guild should have 2 members");

  // Verify roster persistence in the guild manager.
  const guild = guildManager.getGuildForChar(rec2.charId);
  assert.ok(guild, "Player 2 should be in a guild");
  assert.strictEqual(guild!.roster.size, 2, "Guild should have 2 members");
  assert.strictEqual(guild!.roster.get(rec2.charId), "member", "Player 2 should be a member");
  assert.strictEqual(guild!.roster.get(rec1.charId), "master", "Player 1 should be master");

  console.log("[guild] ✔ invite → accept → roster verified");

  await sdk2.leave();
  await sdk1.leave();
}

// ─── Test 3: Only master/officer can invite ─────────────────────────────

async function testRankPermissions(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[guild] ── rank permission check ──");

  const acct1 = `guild_perm1_${Date.now()}`;
  const acct2 = `guild_perm2_${Date.now()}`;
  const acct3 = `guild_perm3_${Date.now()}`;
  const rec1 = accountStore.createCharacter(acct1, {
    name: "PermMaster",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const rec2 = accountStore.createCharacter(acct2, {
    name: "PermMember",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const rec3 = accountStore.createCharacter(acct3, {
    name: "PermTarget",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  accountStore.setMesos(rec1.charId, 100_000);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk1 = await colyseus.connectTo(serverRoom, { charId: rec1.charId, accountId: acct1 });
  sdk1.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  const sdk2 = await colyseus.connectTo(serverRoom, { charId: rec2.charId, accountId: acct2 });
  sdk2.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  const sdk3 = await colyseus.connectTo(serverRoom, { charId: rec3.charId, accountId: acct3 });
  sdk3.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  // Create guild as master.
  sdk1.send(MessageType.GUILD_CREATE, { name: "PermGuild", color: 0x0000ff });
  await sleep(300);

  // Invite + accept Player 2 as a regular member.
  sdk1.send(MessageType.GUILD_INVITE, { targetSessionId: sdk2.sessionId });
  await sleep(200);
  sdk2.send(MessageType.GUILD_ACCEPT, { fromSessionId: sdk1.sessionId });
  await sleep(300);

  // Verify Player 2 is a member.
  assert.strictEqual(guildManager.getRank(rec2.charId), "member", "Player 2 should be member");

  // Player 2 (member) tries to invite Player 3 — should fail.
  let memberInviteResult: GuildResultPayload | null = null;
  sdk2.onMessage(MessageType.GUILD_RESULT, (msg: GuildResultPayload) => {
    memberInviteResult = msg;
  });
  sdk2.send(MessageType.GUILD_INVITE, { targetSessionId: sdk3.sessionId });
  await sleep(300);

  assert.ok(memberInviteResult, "Should receive result");
  assert.strictEqual(memberInviteResult!.success, false, "Member should not be able to invite");
  assert.ok(
    memberInviteResult!.message.toLowerCase().includes("only master or officer"),
    "Error should mention rank restriction",
  );

  // Master promotes Player 2 to officer.
  let rankResult: GuildResultPayload | null = null;
  sdk1.onMessage(MessageType.GUILD_RESULT, (msg: GuildResultPayload) => {
    rankResult = msg;
  });
  sdk1.send(MessageType.GUILD_RANK, { targetCharId: rec2.charId, newRank: "officer" });
  await sleep(300);

  assert.ok(rankResult?.success, "Rank change should succeed");
  assert.strictEqual(
    guildManager.getRank(rec2.charId),
    "officer",
    "Player 2 should now be officer",
  );

  // Officer can now invite.
  let officerInviteResult: GuildResultPayload | null = null;
  sdk2.onMessage(MessageType.GUILD_RESULT, (msg: GuildResultPayload) => {
    officerInviteResult = msg;
  });
  sdk2.send(MessageType.GUILD_INVITE, { targetSessionId: sdk3.sessionId });
  await sleep(300);

  assert.ok(officerInviteResult?.success, "Officer should be able to invite");

  console.log("[guild] ✔ rank permissions enforced correctly");

  await sdk3.leave();
  await sdk2.leave();
  await sdk1.leave();
}

// ─── Test 4: Guild chat relay ────────────────────────────────────────────

async function testGuildChat(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[guild] ── guild chat relay ──");

  const acct1 = `guild_chat1_${Date.now()}`;
  const acct2 = `guild_chat2_${Date.now()}`;
  const rec1 = accountStore.createCharacter(acct1, {
    name: "ChatA",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const rec2 = accountStore.createCharacter(acct2, {
    name: "ChatB",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  accountStore.setMesos(rec1.charId, 100_000);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk1 = await colyseus.connectTo(serverRoom, { charId: rec1.charId, accountId: acct1 });
  sdk1.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  const sdk2 = await colyseus.connectTo(serverRoom, { charId: rec2.charId, accountId: acct2 });
  sdk2.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  // Create guild + add member.
  sdk1.send(MessageType.GUILD_CREATE, { name: "ChatGuild", color: 0xffff00 });
  await sleep(300);
  sdk1.send(MessageType.GUILD_INVITE, { targetSessionId: sdk2.sessionId });
  await sleep(200);
  sdk2.send(MessageType.GUILD_ACCEPT, { fromSessionId: sdk1.sessionId });
  await sleep(300);

  // Player 2 listens for guild chat relay.
  let chatReceived = false;
  let chatPayload: GuildChatRelayPayload | null = null;
  sdk2.onMessage(MessageType.GUILD_CHAT_RELAY, (msg: GuildChatRelayPayload) => {
    chatReceived = true;
    chatPayload = msg;
  });

  // Player 1 sends a guild chat message.
  sdk1.send(MessageType.GUILD_CHAT, { text: "Hello guild!" });
  await sleep(300);

  assert.ok(chatReceived, "Player 2 should have received guild chat");
  assert.ok(chatPayload, "Chat payload should exist");
  assert.strictEqual(chatPayload!.senderName, "ChatA");
  assert.strictEqual(chatPayload!.text, "Hello guild!");

  // Player 1 should NOT receive their own message (sender is excluded).
  let selfChatReceived = false;
  sdk1.onMessage(MessageType.GUILD_CHAT_RELAY, () => {
    selfChatReceived = true;
  });
  sdk1.send(MessageType.GUILD_CHAT, { text: "Self test" });
  await sleep(200);

  assert.ok(!selfChatReceived, "Sender should not receive their own guild chat");

  console.log("[guild] ✔ guild chat relay works");

  await sdk2.leave();
  await sdk1.leave();
}

// ─── Test 5: Leave and disband ───────────────────────────────────────────

async function testLeaveDisband(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[guild] ── leave & disband ──");

  const acct1 = `guild_leave_${Date.now()}`;
  const rec1 = accountStore.createCharacter(acct1, {
    name: "LeaveOnly",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  accountStore.setMesos(rec1.charId, 100_000);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk1 = await colyseus.connectTo(serverRoom, { charId: rec1.charId, accountId: acct1 });
  sdk1.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  // Create guild.
  sdk1.send(MessageType.GUILD_CREATE, { name: "LeaveGuild", color: 0x999999 });
  await sleep(300);
  assert.ok(guildManager.inGuild(rec1.charId), "Should be in guild");

  // Leave.
  let leaveResult: GuildResultPayload | null = null;
  sdk1.onMessage(MessageType.GUILD_RESULT, (msg: GuildResultPayload) => {
    leaveResult = msg;
  });
  sdk1.send(MessageType.GUILD_LEAVE);
  await sleep(300);

  assert.ok(leaveResult?.success, "Leave should succeed");
  assert.ok(!guildManager.inGuild(rec1.charId), "Should no longer be in a guild");

  // Guild should be disbanded (empty).
  const guild = guildManager.getGuildForChar(rec1.charId);
  assert.strictEqual(guild, undefined, "Guild should be disbanded");

  console.log("[guild] ✔ leave & disband works");

  await sdk1.leave();
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testCreateGuild(colyseus);
  await testInviteAcceptRoster(colyseus);
  await testRankPermissions(colyseus);
  await testGuildChat(colyseus);
  await testLeaveDisband(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[guild] PASS ✔  all guild tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[guild] FAIL ✘", err);
  process.exit(1);
});
