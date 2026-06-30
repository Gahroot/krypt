/**
 * Ranged / magic combat test — proves attack-type resolution from class archetype and
 * that ranged classes can hit mobs at distances a Warrior melee swing cannot reach.
 *
 * Uses createRoom + connectTo (same pattern as jobAdvance) to guarantee both players
 * share one room with the same mobs.
 *
 * Run: npx tsx test/rangedCombat.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype, AttackType } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[rangedCombat] FAIL ✘ watchdog timeout");
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

// ─── Test 1: Archer hits far mob, Warrior cannot ────────────────────────────

async function testArcherHitsFarMob(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[rangedCombat] ── Archer vs Warrior range ──");

  // Create Warrior + Archer characters in the store.
  const warAcct = `ranged_war_${Date.now()}`;
  const warRec = accountStore.createCharacter(warAcct, {
    name: "RangedWar",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  const arcAcct = `ranged_arc_${Date.now()}`;
  const arcRec = accountStore.createCharacter(arcAcct, {
    name: "RangedArc",
    archetype: ClassArchetype.ARCHER,
    appearance: DEFAULT_APPEARANCE,
  });

  // Create ONE room, connect both players to it.
  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const warSdk = await colyseus.connectTo(serverRoom, {
    charId: warRec.charId,
    accountId: warAcct,
  });
  warSdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const arcSdk = await colyseus.connectTo(serverRoom, {
    charId: arcRec.charId,
    accountId: arcAcct,
  });
  arcSdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const warPlayer = serverRoom.state.players.get(warSdk.sessionId);
  const arcPlayer = serverRoom.state.players.get(arcSdk.sessionId);
  assert.ok(warPlayer, "Warrior player should exist");
  assert.ok(arcPlayer, "Archer player should exist");

  // Verify attack types resolved correctly.
  assert.strictEqual(warPlayer.attackType, AttackType.MELEE, "Warrior defaults to MELEE");
  assert.strictEqual(arcPlayer.attackType, AttackType.RANGED, "Archer defaults to RANGED");
  console.log(
    `[rangedCombat] attack types: Warrior=${warPlayer.attackType} Archer=${arcPlayer.attackType}`,
  );

  // Find the first mob and position it far away.
  const firstMobId = Array.from(serverRoom.state.mobs.keys())[0] as string;
  const mob = serverRoom.state.mobs.get(firstMobId);
  assert.ok(mob, "mob should exist");
  const mobStartHp = mob.hp;

  // Place both players at x=100 and the mob RANGED_TEST_DIST px to the right.
  // 250 px sits comfortably inside the archer's 300 px range yet well beyond the
  // 70 px melee range, leaving margin so normal mob wander can't push the mob
  // across the exact range boundary and make this test flaky.
  const RANGED_TEST_DIST = 250;
  warPlayer.x = 100;
  warPlayer.y = mob.y;
  warPlayer.facing = 1;
  arcPlayer.x = 100;
  arcPlayer.y = mob.y;
  arcPlayer.facing = 1;
  mob.x = arcPlayer.x + RANGED_TEST_DIST;

  // Let the server tick a few frames to settle positions.
  await sleep(100);

  // Re-pin the mob right before the swing so AI wander during the settle window
  // can't drift it out of range before the attack is processed.
  mob.x = arcPlayer.x + RANGED_TEST_DIST;
  mob.y = arcPlayer.y;

  // Archer attacks from far — cooldown is 450ms, so send one attack and wait.
  arcSdk.send(MessageType.INPUT, {
    left: false,
    right: false,
    up: false,
    down: false,
    attack: true,
    jump: false,
    interact: false,
    tick: 0,
  });
  await sleep(600); // wait for cooldown to expire + server tick

  const mobAfterArc = serverRoom.state.mobs.get(firstMobId);
  assert.ok(mobAfterArc, "mob should still exist");
  assert.ok(mobAfterArc.hp < mobStartHp, "Archer should have damaged mob from far");
  console.log(
    `[rangedCombat] Archer attacked: mob HP ${mobStartHp} → ${mobAfterArc.hp} at distance 300`,
  );

  // Warrior attacks from far — should NOT hit.
  // Re-pin the mob at the same far distance so it is unambiguously outside the
  // 70 px melee range at the moment the warrior's swing is processed.
  const hpBeforeWar = mobAfterArc.hp;
  mobAfterArc.x = warPlayer.x + RANGED_TEST_DIST;
  mobAfterArc.y = warPlayer.y;
  warSdk.send(MessageType.INPUT, {
    left: false,
    right: false,
    up: false,
    down: false,
    attack: true,
    jump: false,
    interact: false,
    tick: 1,
  });
  await sleep(600);

  const mobAfterWar = serverRoom.state.mobs.get(firstMobId);
  assert.strictEqual(
    mobAfterWar.hp,
    hpBeforeWar,
    `Warrior should NOT damage mob from ${RANGED_TEST_DIST} px`,
  );
  console.log(
    `[rangedCombat] Warrior at ${RANGED_TEST_DIST}px: mob HP unchanged at ${mobAfterWar.hp}`,
  );

  // Move Warrior into melee range — should hit now.
  warPlayer.x = mobAfterWar.x - 40;
  warPlayer.facing = 1;
  await sleep(100); // let server tick to update position

  warSdk.send(MessageType.INPUT, {
    left: false,
    right: false,
    up: false,
    down: false,
    attack: true,
    jump: false,
    interact: false,
    tick: 2,
  });
  await sleep(600);

  const mobAfterMelee = serverRoom.state.mobs.get(firstMobId);
  assert.ok(
    mobAfterMelee.hp < hpBeforeWar || mobAfterMelee.dead,
    "Warrior should damage mob in melee range",
  );
  console.log(
    `[rangedCombat] ✔ Warrior melee: mob HP ${hpBeforeWar} → ${mobAfterMelee.hp} (dead=${mobAfterMelee.dead})`,
  );

  await warSdk.leave();
  await arcSdk.leave();
}

// ─── Test 2: Mage magic bolt hits multiple mobs ─────────────────────────────

async function testMageAoeHitsMultiple(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[rangedCombat] ── Mage magic AoE ──");

  const mageAcct = `ranged_mage_${Date.now()}`;
  const mageRec = accountStore.createCharacter(mageAcct, {
    name: "RangedMage",
    archetype: ClassArchetype.MAGE,
    appearance: { ...DEFAULT_APPEARANCE, gender: "F" },
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: mageRec.charId,
    accountId: mageAcct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "Mage player should exist");
  assert.strictEqual(player.attackType, AttackType.MAGIC, "Mage defaults to MAGIC");
  console.log(`[rangedCombat] Mage attack type: ${player.attackType}`);

  // Collect two mobs on the same platform.
  const mobIds = Array.from(serverRoom.state.mobs.keys()).slice(0, 2) as string[];
  assert.ok(mobIds.length >= 2, "need at least 2 mobs for AoE test");

  const mob1 = serverRoom.state.mobs.get(mobIds[0]!);
  const mob2 = serverRoom.state.mobs.get(mobIds[1]!);
  assert.ok(mob1 && mob2, "both mobs should exist");

  // Position mobs within magic range (250 px) but spread out.
  mob1.x = player.x + 100;
  mob1.y = player.y;
  mob2.x = player.x + 200;
  mob2.y = player.y;

  const mob1StartHp = mob1.hp;
  const mob2StartHp = mob2.hp;
  player.facing = 1;

  await sleep(100);

  // Mage attacks.
  sdk.send(MessageType.INPUT, {
    left: false,
    right: false,
    up: false,
    down: false,
    attack: true,
    jump: false,
    interact: false,
    tick: 0,
  });
  await sleep(600);

  const mob1After = serverRoom.state.mobs.get(mobIds[0]!);
  const mob2After = serverRoom.state.mobs.get(mobIds[1]!);

  const mob1Hit = mob1After.hp < mob1StartHp || mob1After.dead;
  const mob2Hit = mob2After.hp < mob2StartHp || mob2After.dead;
  assert.ok(mob1Hit && mob2Hit, "magic AoE should damage both mobs in range");
  console.log(
    `[rangedCombat] ✔ Mage AoE: mob1 HP ${mob1StartHp}→${mob1After.hp} (dead=${mob1After.dead}), ` +
      `mob2 HP ${mob2StartHp}→${mob2After.hp} (dead=${mob2After.dead})`,
  );

  await sdk.leave();
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testArcherHitsFarMob(colyseus);
  await testMageAoeHitsMultiple(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[rangedCombat] PASS ✔  all ranged/magic combat tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[rangedCombat] FAIL ✘", err);
  process.exit(1);
});
