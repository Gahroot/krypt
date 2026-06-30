/**
 * Skill Cast integration test — proves the full learn→cast pipeline:
 *   1. Learn a tier-1 active skill, cast it → MP deducted, mob takes damage.
 *   2. Cast without enough MP → rejected, MP unchanged.
 *   3. Cast without learning the skill → rejected.
 *   4. Cast with MP just barely below cost → rejected.
 *   5. Beginner nimble_strike learn → cast.
 *
 * Run: npx tsx test/skillCast.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import { ClassArchetype, totalSpByLevel, skillStatAt, allSkillsForClass } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[skillCast] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 45_000);

const DEFAULT_APPEARANCE = {
  gender: "M" as const,
  skinId: "skin_0",
  hairId: "hair_0",
  hairColorId: "hc_0",
  faceId: "face_0",
  outfitId: "outfit_0",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function waitForMessage(sdkRoom: any, type: number, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`MessageType ${type} was not received within ${timeoutMs}ms`));
    }, timeoutMs);
    sdkRoom.onMessage(type, (message: any) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

function sendAndWait(sdkRoom: any, type: number, payload: any): Promise<any> {
  const p = waitForMessage(sdkRoom, type);
  sdkRoom.send(type, payload);
  return p;
}

/** Position the first alive mob adjacent to the player and return its key. */
function findAndPositionMob(state: any, playerX: number, playerY: number): string {
  for (const [id, mob] of state.mobs.entries()) {
    if (!mob.dead) {
      mob.x = playerX + 30;
      mob.y = playerY;
      return id;
    }
  }
  throw new Error("no alive mobs in the room");
}

// ─── Test 1: Learn → cast → MP drops + mob takes damage ──────────────────────

async function testLearnAndCast(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[skillCast] ── learn & cast: warrior.crushing_blow ──");

  const accountId = `skillcast_lc_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `CastLC_${Date.now()}`,
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });
  accountStore.updateCharacter(rec.charId, {
    level: 15,
    exp: 0,
    ap: 70,
    sp: totalSpByLevel(15),
    stats: { STR: 20, DEX: 10, INT: 4, LUK: 4, HP: 200, MP: 50 },
    maxHp: 350,
    maxMp: 50,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(250);

  const player = serverRoom.state.players.get(sdkRoom.sessionId)!;
  assert.ok(player, "player exists");

  const skillId = "warrior.crushing_blow";
  const skillDef = allSkillsForClass(ClassArchetype.WARRIOR).find((s) => s.id === skillId)!;
  assert.ok(skillDef, "crushing_blow exists");
  assert.strictEqual(skillDef.kind, "active");

  // 1) Learn the skill.
  const learnResult = await sendAndWait(sdkRoom, MessageType.LEARN_SKILL, { skillId });
  assert.strictEqual(learnResult.success, true, "learn succeeds");
  assert.strictEqual(player.skillBook[skillId], 1, "skill level 1 in book");
  assert.ok(player.sp < totalSpByLevel(15), "SP decremented");

  // 2) Verify skill has MP cost and damage multiplier.
  const resolvedStats = skillStatAt(skillDef, 1);
  assert.ok(resolvedStats.mpCost > 0, "skill costs MP at level 1");
  assert.ok(resolvedStats.damagePercent > 100, "damagePercent > 100 (stronger than basic)");
  console.log(
    `[skillCast] crushing_blow lv1: mpCost=${resolvedStats.mpCost}, dmgPct=${resolvedStats.damagePercent}`,
  );

  // 3) Position a mob and record state.
  const mobId = findAndPositionMob(serverRoom.state, player.x, player.y);
  const mobBefore = serverRoom.state.mobs.get(mobId)!;
  const mobHpBefore = mobBefore.hp;
  const mpBefore = player.mp;

  // 4) Cast the skill.
  const castResult = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, { skillId });
  assert.strictEqual(castResult.success, true, "cast succeeds");
  assert.ok(castResult.cooldownMs >= 0, "has cooldown");

  // 5) Verify MP deducted.
  assert.strictEqual(player.mp, mpBefore - resolvedStats.mpCost, "MP deducted by cost");
  console.log(`[skillCast] ✔ MP: ${mpBefore} → ${player.mp}`);

  // 6) Verify mob took damage. A strong skill can one-shot a low-HP mob, in
  //    which case the authoritative server removes it from state entirely — a
  //    kill still proves the skill dealt damage, so treat a vanished mob as a
  //    lethal hit rather than crashing on an undefined lookup.
  const mobAfter = serverRoom.state.mobs.get(mobId);
  if (!mobAfter) {
    console.log(`[skillCast] ✔ mob HP: ${mobHpBefore} → 0 (skill killed the mob)`);
  } else {
    assert.ok(mobAfter.hp < mobHpBefore, "mob took damage from skill");
    const dmg = mobHpBefore - mobAfter.hp;
    assert.ok(dmg > 0, "skill damage > 0");
    console.log(`[skillCast] ✔ mob HP: ${mobHpBefore} → ${mobAfter.hp} (skill dealt ${dmg})`);
  }

  console.log(
    `[skillCast] ✔ learn+cast verified (dmgPct=${resolvedStats.damagePercent} > basic 100)`,
  );

  await sdkRoom.leave();
}

// ─── Test 2: Cast without MP → rejected ──────────────────────────────────────

async function testCastNoMp(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[skillCast] ── cast without MP → rejected ──");

  const accountId = `skillcast_nomp_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `CastNoMp_${Date.now()}`,
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });
  const fakeBook: Record<string, number> = { "warrior.crushing_blow": 1 };
  accountStore.updateCharacter(rec.charId, {
    level: 15,
    exp: 0,
    ap: 70,
    sp: totalSpByLevel(15) - 1,
    maxHp: 350,
    maxMp: 50,
    skillBook: fakeBook,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(250);

  const player = serverRoom.state.players.get(sdkRoom.sessionId)!;
  // Force MP to 0 after join (server auto-fills MP on join via || operator).
  player.mp = 0;
  assert.strictEqual(player.mp, 0, "MP is 0");
  assert.strictEqual(player.skillBook["warrior.crushing_blow"], 1, "skill is learned");

  // Cast should fail.
  const result = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.crushing_blow",
  });
  assert.strictEqual(result.success, false, "cast rejected");
  assert.ok(result.message.toLowerCase().includes("mp"), "error mentions MP");
  assert.strictEqual(player.mp, 0, "MP unchanged");
  console.log(`[skillCast] ✔ no-MP rejected: "${result.message}"`);

  await sdkRoom.leave();
}

// ─── Test 3: Cast without learning → rejected ────────────────────────────────

async function testCastNotLearned(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[skillCast] ── cast without learning → rejected ──");

  const accountId = `skillcast_nolearn_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `CastNoLearn_${Date.now()}`,
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });
  accountStore.updateCharacter(rec.charId, {
    level: 15,
    exp: 0,
    ap: 70,
    sp: totalSpByLevel(15),
    stats: { STR: 20, DEX: 10, INT: 4, LUK: 4, HP: 200, MP: 50 },
    maxHp: 350,
    maxMp: 50,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(250);

  const player = serverRoom.state.players.get(sdkRoom.sessionId)!;
  assert.deepStrictEqual(player.skillBook, {}, "skill book empty");

  const result = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.crushing_blow",
  });
  assert.strictEqual(result.success, false, "cast rejected");
  assert.ok(result.message.toLowerCase().includes("not learned"), "error says not learned");
  console.log(`[skillCast] ✔ not-learned rejected: "${result.message}"`);

  await sdkRoom.leave();
}

// ─── Test 4: Cast with MP just barely below cost → rejected ──────────────────

async function testCastInsufficientMp(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[skillCast] ── MP < cost → rejected ──");

  const skillDef = allSkillsForClass(ClassArchetype.WARRIOR).find(
    (s) => s.id === "warrior.crushing_blow",
  )!;
  const resolvedStats = skillStatAt(skillDef, 1);
  const insufficientMp = Math.max(0, resolvedStats.mpCost - 1);

  const accountId = `skillcast_insuff_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `CastInsuffMp_${Date.now()}`,
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });
  const fakeBook: Record<string, number> = { "warrior.crushing_blow": 1 };
  accountStore.updateCharacter(rec.charId, {
    level: 15,
    exp: 0,
    ap: 70,
    sp: totalSpByLevel(15) - 1,
    maxHp: 350,
    maxMp: 50,
    skillBook: fakeBook,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(250);

  const player = serverRoom.state.players.get(sdkRoom.sessionId)!;
  // Force MP to amount just below skill cost after join.
  player.mp = insufficientMp;
  assert.ok(player.mp < resolvedStats.mpCost, "MP < cost");

  const result = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.crushing_blow",
  });
  assert.strictEqual(result.success, false, "cast rejected");
  assert.strictEqual(player.mp, insufficientMp, "MP unchanged");
  console.log(`[skillCast] ✔ insufficient MP rejected: "${result.message}"`);

  await sdkRoom.leave();
}

// ─── Test 5: Beginner nimble_strike learn → cast ────────────────────────────

async function testBeginnerNimbleStrike(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[skillCast] ── beginner.nimble_strike learn & cast ──");

  const accountId = `skillcast_beginner_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `CastBeg_${Date.now()}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  accountStore.updateCharacter(rec.charId, {
    level: 12,
    exp: 0,
    ap: 55,
    sp: totalSpByLevel(12),
    stats: { STR: 10, DEX: 8, INT: 4, LUK: 4, HP: 150, MP: 30 },
    maxHp: 200,
    maxMp: 30,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(250);

  const player = serverRoom.state.players.get(sdkRoom.sessionId)!;
  assert.ok(player, "beginner exists");
  assert.strictEqual(player.archetype, ClassArchetype.BEGINNER);

  // Learn nimble_strike.
  const learnResult = await sendAndWait(sdkRoom, MessageType.LEARN_SKILL, {
    skillId: "beginner.nimble_strike",
  });
  assert.strictEqual(learnResult.success, true, "beginner learn succeeds");
  assert.strictEqual(player.skillBook["beginner.nimble_strike"], 1);

  // Position a mob and record state.
  const mobId = findAndPositionMob(serverRoom.state, player.x, player.y);
  const mobHpBefore = serverRoom.state.mobs.get(mobId)!.hp;
  const mpBefore = player.mp;

  // Cast nimble_strike.
  const castResult = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "beginner.nimble_strike",
  });
  assert.strictEqual(castResult.success, true, "beginner cast succeeds");

  // Verify MP deducted.
  const skillDef = allSkillsForClass(ClassArchetype.BEGINNER).find(
    (s) => s.id === "beginner.nimble_strike",
  )!;
  const stats = skillStatAt(skillDef, 1);
  assert.ok(stats.mpCost > 0, "beginner skill costs MP");
  assert.ok(stats.damagePercent > 100, "beginner skill > 100% damage");
  assert.strictEqual(player.mp, mpBefore - stats.mpCost, "beginner MP deducted");
  console.log(`[skillCast] ✔ beginner MP: ${mpBefore} → ${player.mp}`);

  // Verify mob took damage. A vanished mob means the skill killed it (the
  // server removes dead mobs from state), which still proves damage was dealt.
  const mobAfter = serverRoom.state.mobs.get(mobId);
  if (!mobAfter) {
    console.log(`[skillCast] ✔ beginner mob HP: ${mobHpBefore} → 0 (skill killed the mob)`);
  } else {
    assert.ok(mobAfter.hp < mobHpBefore, "mob took nimble_strike damage");
    const dmg = mobHpBefore - mobAfter.hp;
    console.log(`[skillCast] ✔ beginner mob HP: ${mobHpBefore} → ${mobAfter.hp} (dealt ${dmg})`);
  }

  await sdkRoom.leave();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await boot(appConfig);

  await testLearnAndCast(colyseus);
  await testCastNoMp(colyseus);
  await testCastNotLearned(colyseus);
  await testCastInsufficientMp(colyseus);
  await testBeginnerNimbleStrike(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[skillCast] PASS ✔  all skill cast tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[skillCast] FAIL ✘", err);
  process.exit(1);
});
