/**
 * Party system test — proves forming a party, shared EXP on a mob kill, and leader
 * reassignment on disconnect.
 *
 * Run: npx tsx test/party.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype, getMobDef } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";
import type { PartyUpdatePayload, PartyInviteReceivedPayload } from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[party] FAIL ✘ watchdog timeout");
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

// ─── Test 1: Form a party via invite + accept ──────────────────────────────

async function testFormParty(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[party] ── form party ──");

  const acct1 = `party_1a_${Date.now()}`;
  const acct2 = `party_1b_${Date.now()}`;

  const rec1 = accountStore.createCharacter(acct1, {
    name: "PartyA",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const rec2 = accountStore.createCharacter(acct2, {
    name: "PartyB",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

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

  // Set up invite listener BEFORE sending the invite.
  let inviteReceived = false;
  let invitePayload: PartyInviteReceivedPayload | null = null;
  sdk2.onMessage(MessageType.PARTY_INVITE_RECEIVED, (msg: PartyInviteReceivedPayload) => {
    inviteReceived = true;
    invitePayload = msg;
  });

  // Player 1 invites player 2.
  sdk1.send(MessageType.PARTY_INVITE, { targetName: "PartyB" });
  await sleep(300);

  assert.ok(inviteReceived, "Player 2 should have received a party invite");
  assert.ok(invitePayload, "Invite payload should exist");
  assert.strictEqual(invitePayload!.fromName, "PartyA", "Inviter name should be PartyA");

  // Player 2 accepts.
  let partyUpdate2: PartyUpdatePayload | null = null;
  sdk2.onMessage(MessageType.PARTY_UPDATE, (msg: PartyUpdatePayload) => {
    partyUpdate2 = msg;
  });

  sdk2.send(MessageType.PARTY_ACCEPT, { fromCharId: rec1.charId });
  await sleep(300);

  // Both should now have party state.
  const p1 = serverRoom.state.players.get(sdk1.sessionId)!;
  const p2 = serverRoom.state.players.get(sdk2.sessionId)!;
  assert.ok(p1, "Player 1 should exist");
  assert.ok(p2, "Player 2 should exist");

  // Verify party was formed (check via manager).
  // We can verify by checking that a party_update was sent to both.
  assert.ok(partyUpdate2, "Player 2 should have received a party update");
  if (partyUpdate2) {
    assert.ok(partyUpdate2.partyId, "Party should have an id");
    assert.strictEqual(partyUpdate2.members.length, 2, "Party should have 2 members");
    assert.ok(
      partyUpdate2.members.some((m) => m.leader),
      "One member should be the leader",
    );
    // Player 1 (inviter) should be the leader.
    const leader = partyUpdate2.members.find((m) => m.leader);
    assert.strictEqual(leader?.sessionId, sdk1.sessionId, "Player 1 should be the leader");
  }

  console.log("[party] ✔ party formed with 2 members");

  await sdk2.leave();
  await sdk1.leave();
}

// ─── Test 2: Shared EXP distribution on a mob kill ─────────────────────────

async function testSharedExp(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[party] ── shared EXP on kill ──");

  const acct1 = `party_exp1_${Date.now()}`;
  const acct2 = `party_exp2_${Date.now()}`;

  const rec1 = accountStore.createCharacter(acct1, {
    name: "ExpA",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const rec2 = accountStore.createCharacter(acct2, {
    name: "ExpB",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

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

  const p1 = serverRoom.state.players.get(sdk1.sessionId)!;
  const p2 = serverRoom.state.players.get(sdk2.sessionId)!;
  assert.ok(p1 && p2, "Both players should exist");

  // Place both players near each other.
  p1.x = 100;
  p1.y = 300;
  p2.x = 120;
  p2.y = 300;

  // Form a party (player 1 invites, player 2 accepts).
  sdk1.send(MessageType.PARTY_INVITE, { targetName: "ExpB" });
  await sleep(100);
  sdk2.send(MessageType.PARTY_ACCEPT, { fromCharId: rec1.charId });
  await sleep(300);

  // Record pre-kill EXP and level (level-up resets raw EXP within the new level).
  const exp1Before = p1.exp;
  const exp2Before = p2.exp;
  const level1Before = p1.level;
  const level2Before = p2.level;
  console.log(
    `[party] EXP before kill: ${p1.name} Lv${level1Before} ${exp1Before}, ${p2.name} Lv${level2Before} ${exp2Before}`,
  );

  // Find a mob and place it between them.
  let mobId = "";
  let mobDefId = "";
  for (const [id, mob] of serverRoom.state.mobs.entries()) {
    if (!mob.dead) {
      mobId = id;
      mobDefId = mob.mobId;
      break;
    }
  }
  assert.ok(mobId, "Should find an alive mob");
  const mob = serverRoom.state.mobs.get(mobId)!;
  const mobDef = getMobDef(mobDefId);
  assert.ok(mobDef, "Mob def should exist");

  // Place mob near both players.
  mob.x = 110;
  mob.y = 300;
  mob.hp = mobDef.maxHp;

  console.log(`[party] Mob: ${mobDef.name} (HP ${mob.maxHp}, EXP ${mobDef.exp})`);

  // Kill the mob by setting HP to 1 and having player 1 attack.
  mob.hp = 1;
  p1.attackCooldown = 0;
  p1.x = mob.x - 30; // in melee range
  p1.facing = 1;
  p1.climbing = false;
  p1.dead = false;
  p1.hp = 5000;
  p1.maxHp = 5000; // prevent HP being capped to base maxHp on effect ticks
  p1.str = 999; // guarantee the hit lands against any mob defense/avoid
  p1.inputQueue.push({
    left: false,
    right: false,
    up: false,
    down: false,
    attack: true,
    jump: false,
    interact: false,
    tick: 999,
  });

  // Wait for the simulation tick to process the attack and kill.
  await sleep(300);

  const exp1After = p1.exp;
  const exp2After = p2.exp;
  console.log(
    `[party] EXP after kill: ${p1.name} Lv${p1.level} ${exp1After}, ${p2.name} Lv${p2.level} ${exp2After}`,
  );

  // Both should have gained EXP (shared with party bonus).
  // A level-up resets raw EXP within the new level, so check level OR exp increased.
  const p1Gained = p1.level > level1Before || exp1After > exp1Before;
  const p2Gained = p2.level > level2Before || exp2After > exp2Before;
  assert.ok(p1Gained, "Player 1 should have gained EXP (or leveled up)");
  assert.ok(p2Gained, "Player 2 should have gained EXP (or leveled up)");

  console.log(`[party] ✔ both players gained EXP from shared party kill (mob base: ${mobDef.exp})`);

  await sdk2.leave();
  await sdk1.leave();
}

// ─── Test 3: Leader reassignment on disconnect ─────────────────────────────

async function testLeaderReassign(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[party] ── leader reassignment on disconnect ──");

  const acct1 = `party_lead1_${Date.now()}`;
  const acct2 = `party_lead2_${Date.now()}`;

  const rec1 = accountStore.createCharacter(acct1, {
    name: "LeaderA",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const rec2 = accountStore.createCharacter(acct2, {
    name: "FollowB",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

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

  // Form a party with sdk1 as leader.
  sdk1.send(MessageType.PARTY_INVITE, { targetName: "FollowB" });
  await sleep(100);
  sdk2.send(MessageType.PARTY_ACCEPT, { fromCharId: rec1.charId });
  await sleep(300);

  // Verify sdk1 is leader.
  let latestUpdate: PartyUpdatePayload | null = null;
  sdk2.onMessage(MessageType.PARTY_UPDATE, (msg: PartyUpdatePayload) => {
    latestUpdate = msg;
  });

  // Leader (sdk1) disconnects. A consented leave fires onLeave immediately,
  // which removes the player from the party and syncs the update to sdk2.
  await sdk1.leave();
  await sleep(500);

  // sdk2 should have received a party update showing them as the new leader.
  assert.ok(latestUpdate, "Player 2 should have received a party update after leader left");
  if (latestUpdate) {
    assert.strictEqual(latestUpdate.members.length, 1, "Party should now have 1 member");
    assert.strictEqual(
      latestUpdate.members[0].sessionId,
      sdk2.sessionId,
      "Remaining member should be player 2",
    );
    assert.ok(latestUpdate.members[0].leader, "Player 2 should now be the leader");
  }

  // Verify the leader change chat message was sent.
  // (We can't easily assert on chat in the test since it goes through broadcast,
  //  but we verified the party update has the right leader.)

  console.log("[party] ✔ leader reassigned to remaining member on disconnect");

  await sdk2.leave();
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testFormParty(colyseus);
  await testSharedExp(colyseus);
  await testLeaderReassign(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[party] PASS ✔  all party tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[party] FAIL ✘", err);
  process.exit(1);
});
