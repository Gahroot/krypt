/**
 * Mob AI combat test — proves mobs actively aggro, chase, and damage players
 * using the authoritative shared combat engine, and de-aggro on range.
 *
 * Run: npx tsx test/mobCombat.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype, getMobDef } from "@maple/shared";
import appConfig from "../src/app.config";
import { accountStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[mobCombat] FAIL ✘ watchdog timeout");
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

// ─── Test 1: Mob aggros a stationary player and deals damage ─────────────────

async function testMobAggroAndDamage(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[mobCombat] ── mob aggro + damage ──");

  const acct = `mob_dmg_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: `MobDmg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");
  const playerStartHp = player.hp;
  console.log(`[mobCombat] player HP: ${playerStartHp}`);

  // Grab the first alive mob and teleport it right next to the player.
  let mobId = "";
  let mobDefId = "";
  for (const [id, mob] of serverRoom.state.mobs.entries()) {
    if (!mob.dead) {
      mobId = id;
      mobDefId = mob.mobId;
      break;
    }
  }
  assert.ok(mobId, "should find an alive mob");
  const mob = serverRoom.state.mobs.get(mobId)!;
  const mobDef = getMobDef(mobDefId);
  assert.ok(mobDef, "mob def should exist");

  console.log(`[mobCombat] using mob: ${mobDef.name} (Lv${mobDef.level}, HP ${mobDef.maxHp})`);

  // Place mob directly adjacent to player on the same platform.
  mob.x = player.x + 20;
  mob.y = player.y;
  mob.aiState = "chase";
  mob.targetSessionId = sdk.sessionId;

  // Wait for the mob AI to tick and attack. The mob needs time to:
  // 1. Transition from chase→attack (within attack range)
  // 2. Fire an attack (cooldown 1200ms default)
  // 3. ComputeDamage resolves
  await sleep(2500);

  const playerAfter = serverRoom.state.players.get(sdk.sessionId)!;
  assert.ok(playerAfter.hp < playerStartHp, "player should have taken damage from mob");
  console.log(
    `[mobCombat] ✔ mob dealt damage: HP ${playerStartHp} → ${playerAfter.hp} (lost ${playerStartHp - playerAfter.hp})`,
  );

  // Verify the mob's AI state is attack (still targeting us).
  assert.strictEqual(mob.aiState, "attack", "mob should be in attack state while targeting player");

  await sdk.leave();
}

// ─── Test 2: Mob de-aggros when player moves out of range ────────────────────

async function testMobDeaggro(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[mobCombat] ── mob de-aggro on range ──");

  const acct = `mob_deaggro_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: `MobDeaggro_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  // Grab the first alive mob.
  let mobId = "";
  for (const [id, mob] of serverRoom.state.mobs.entries()) {
    if (!mob.dead) {
      mobId = id;
      break;
    }
  }
  assert.ok(mobId, "should find an alive mob");
  const mob = serverRoom.state.mobs.get(mobId)!;

  // Place mob within aggro range but OUTSIDE attack range.
  mob.x = player.x - 120;
  mob.y = player.y;
  mob.aiState = "chase";
  mob.targetSessionId = sdk.sessionId;

  await sleep(100);
  // Mob may have already transitioned to attack if it closed the gap during ticks.
  const preMove = mob.aiState;
  assert.ok(preMove === "chase" || preMove === "attack", "mob should be chasing or attacking");

  // Teleport the player far away — beyond deaggro range.
  player.x = mob.x + 500;
  player.y = mob.y;

  // Wait for the mob AI tick to process the distance.
  await sleep(500);

  assert.strictEqual(mob.aiState, "idle", "mob should have de-aggroed and returned to idle");
  assert.strictEqual(mob.targetSessionId, "", "target should be cleared");
  console.log(`[mobCombat] ✔ mob de-aggroed after player moved out of range`);

  await sdk.leave();
}

// ─── Test 3: Mob de-aggros when player goes to different platform (vertical LoS) ─

async function testMobDeaggroVertical(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[mobCombat] ── mob de-aggro on vertical separation ──");

  const acct = `mob_vdeaggro_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: `MobVDeaggro_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  let mobId = "";
  for (const [id, mob] of serverRoom.state.mobs.entries()) {
    if (!mob.dead) {
      mobId = id;
      break;
    }
  }
  assert.ok(mobId, "should find an alive mob");
  const mob = serverRoom.state.mobs.get(mobId)!;

  // Place mob within aggro range but OUTSIDE attack range.
  mob.x = player.x - 120;
  mob.y = player.y;
  mob.aiState = "chase";
  mob.targetSessionId = sdk.sessionId;

  await sleep(100);

  // Move the player vertically far away (different platform).
  player.x = mob.x; // same horizontal
  player.y = mob.y - 300; // way above (different foothold)

  await sleep(500);

  assert.strictEqual(
    mob.aiState,
    "idle",
    "mob should de-aggro when player is on a different platform",
  );
  assert.strictEqual(mob.targetSessionId, "", "target cleared after vertical de-aggro");
  console.log(`[mobCombat] ✔ mob de-aggroed on vertical separation`);

  await sdk.leave();
}

// ─── Test 4: Dead player mob stops attacking ──────────────────────────────────

async function testMobStopsOnPlayerDeath(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[mobCombat] ── mob stops when player dies ──");

  const acct = `mob_death_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: `MobDeath_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  let mobId = "";
  for (const [id, mob] of serverRoom.state.mobs.entries()) {
    if (!mob.dead) {
      mobId = id;
      break;
    }
  }
  assert.ok(mobId, "should find an alive mob");
  const mob = serverRoom.state.mobs.get(mobId)!;

  // Set the mob in chase (within aggro range but outside attack range).
  mob.x = player.x - 120;
  mob.y = player.y;
  mob.aiState = "chase";
  mob.targetSessionId = sdk.sessionId;

  // Force-kill the player.
  player.hp = 1;
  player.dead = true;

  await sleep(500);

  assert.strictEqual(mob.aiState, "idle", "mob should return to idle when its target dies");
  assert.strictEqual(mob.targetSessionId, "", "target cleared after player death");
  console.log(`[mobCombat] ✔ mob returned to idle after player death`);

  await sdk.leave();
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testMobAggroAndDamage(colyseus);
  await testMobDeaggro(colyseus);
  await testMobDeaggroVertical(colyseus);
  await testMobStopsOnPlayerDeath(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[mobCombat] PASS ✔  all mob AI combat tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[mobCombat] FAIL ✘", err);
  process.exit(1);
});
