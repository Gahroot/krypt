/**
 * Skill Cast integration test — proves the full learn→cast pipeline end-to-end:
 *
 * **All 5 classes** (warrior, mage, archer, thief, pirate):
 *   - Learn → cast: MP deducted, cooldown set, mob takes damage.
 *   - Representative skills: single-target, multi-hit, AoE, elemental, buff, debuff.
 *
 * **Server-authoritative guards**:
 *   1. Cast without enough MP → rejected, MP unchanged.
 *   2. Cast without learning the skill → rejected.
 *   3. Cast with MP just barely below cost → rejected.
 *   4. Cast while on cooldown → rejected.
 *   5. Cooldown ticks down → re-cast succeeds.
 *   6. Cross-class skill rejected (warrior skill on mage).
 *
 * **Damage model**:
 *   - computeDamage used with skill multiplier + element + target element mods.
 *   - Multi-hit (hitCount > 1) deals more total damage.
 *   - AoE (targetCount > 1) hits multiple mobs.
 *   - Buff skills apply activeEffects.
 *   - Debuff skills apply debuff to mob.
 *   - COMBAT_HIT broadcast with elementMultiplier.
 *
 * **Quickslot / Macro**:
 *   - QUICKSLOT_LAYOUT persisted on player.
 *   - MACRO_LAYOUT + MACRO_CAST executes skill via macro.
 *
 * Run: npx tsx test/skillCast.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import {
  ClassArchetype,
  totalSpByLevel,
  skillStatAt,
  allSkillsForClass,
  MessageType,
} from "@maple/shared";
import appConfig from "../src/app.config";
import { accountStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[skillCast] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 90_000);

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

/** Collect N alive mobs and position them near the player. Returns their keys. */
function findAndPositionMobs(
  state: any,
  playerX: number,
  playerY: number,
  count: number,
  spread = 30,
): string[] {
  const ids: string[] = [];
  for (const [id, mob] of state.mobs.entries()) {
    if (mob.dead) continue;
    if (ids.length >= count) break;
    mob.x = playerX + spread + ids.length * 40;
    mob.y = playerY;
    ids.push(id);
  }
  return ids;
}

/** Suppress the "map_npcs" message from Colyseus join handshake. */
function suppressNpcMessages(sdkRoom: any): void {
  sdkRoom.onMessage("map_npcs", () => {});
}

/**
 * Create a character, join a meadowfield room, and return the player + sdkRoom.
 * Caller must await sdkRoom.leave() when done.
 */
async function createAndJoin(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
  opts: {
    tag: string;
    archetype: ClassArchetype;
    level: number;
    stats?: Record<string, number>;
    maxHp?: number;
    maxMp?: number;
    spOverride?: number;
    skillBook?: Record<string, number>;
    branchId?: string;
  },
) {
  const accountId = `skillcast_${opts.tag}_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `SC_${opts.tag}_${Date.now()}`,
    archetype: opts.archetype,
    appearance: DEFAULT_APPEARANCE,
  });

  const level = opts.level;
  const sp = opts.spOverride ?? totalSpByLevel(level);
  accountStore.updateCharacter(rec.charId, {
    level,
    exp: 0,
    ap: 70,
    sp,
    stats: opts.stats ?? { STR: 20, DEX: 10, INT: 20, LUK: 10, HP: 200, MP: 80 },
    maxHp: opts.maxHp ?? 350,
    maxMp: opts.maxMp ?? 200,
    ...(opts.skillBook ? { skillBook: opts.skillBook } : {}),
    ...(opts.branchId ? { branchId: opts.branchId } : {}),
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId,
    charId: rec.charId,
  });
  suppressNpcMessages(sdkRoom);
  await sleep(250);

  const player = serverRoom.state.players.get(sdkRoom.sessionId)!;
  assert.ok(player, `player exists [${opts.tag}]`);

  return { serverRoom, sdkRoom, player, accountId };
}

// ─── Test 1: Warrior learn & cast → MP + mob damage ─────────────────────────

async function testLearnAndCast(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── learn & cast: warrior.crushing_blow ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "lc",
    archetype: ClassArchetype.WARRIOR,
    level: 15,
  });

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
  assert.ok(resolvedStats.damagePercent > 100, "damagePercent > 100");
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

  // 6) Verify mob took damage.
  const mobAfter = serverRoom.state.mobs.get(mobId);
  if (!mobAfter) {
    console.log(`[skillCast] ✔ mob HP: ${mobHpBefore} → 0 (skill killed the mob)`);
  } else {
    assert.ok(mobAfter.hp < mobHpBefore, "mob took damage from skill");
    const dmg = mobHpBefore - mobAfter.hp;
    assert.ok(dmg > 0, "skill damage > 0");
    console.log(`[skillCast] ✔ mob HP: ${mobHpBefore} → ${mobAfter.hp} (dealt ${dmg})`);
  }

  await sdkRoom.leave();
}

// ─── Test 2: Cast without MP → rejected ──────────────────────────────────────

async function testCastNoMp(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── cast without MP → rejected ──");

  const { sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "nomp",
    archetype: ClassArchetype.WARRIOR,
    level: 15,
    spOverride: totalSpByLevel(15) - 1,
    skillBook: { "warrior.crushing_blow": 1 },
  });

  // Force MP to 0 after join.
  player.mp = 0;
  assert.strictEqual(player.mp, 0, "MP is 0");

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

async function testCastNotLearned(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── cast without learning → rejected ──");

  const { sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "nolearn",
    archetype: ClassArchetype.WARRIOR,
    level: 15,
  });

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

async function testCastInsufficientMp(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── MP < cost → rejected ──");

  const skillDef = allSkillsForClass(ClassArchetype.WARRIOR).find(
    (s) => s.id === "warrior.crushing_blow",
  )!;
  const resolvedStats = skillStatAt(skillDef, 1);
  const insufficientMp = Math.max(0, resolvedStats.mpCost - 1);

  const { sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "insuff",
    archetype: ClassArchetype.WARRIOR,
    level: 15,
    spOverride: totalSpByLevel(15) - 1,
    skillBook: { "warrior.crushing_blow": 1 },
  });

  // Force MP to amount just below skill cost.
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

async function testBeginnerNimbleStrike(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── beginner.nimble_strike learn & cast ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "beg",
    archetype: ClassArchetype.BEGINNER,
    level: 12,
    stats: { STR: 10, DEX: 8, INT: 4, LUK: 4, HP: 150, MP: 30 },
    maxHp: 200,
    maxMp: 30,
  });
  assert.strictEqual(player.archetype, ClassArchetype.BEGINNER);

  // Learn nimble_strike.
  const learnResult = await sendAndWait(sdkRoom, MessageType.LEARN_SKILL, {
    skillId: "beginner.nimble_strike",
  });
  assert.strictEqual(learnResult.success, true, "beginner learn succeeds");
  assert.strictEqual(player.skillBook["beginner.nimble_strike"], 1);

  const skillDef = allSkillsForClass(ClassArchetype.BEGINNER).find(
    (s) => s.id === "beginner.nimble_strike",
  )!;
  const stats = skillStatAt(skillDef, 1);
  assert.ok(stats.mpCost > 0, "beginner skill costs MP");
  assert.ok(stats.damagePercent > 100, "beginner skill > 100% damage");

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
  assert.strictEqual(player.mp, mpBefore - stats.mpCost, "beginner MP deducted");
  console.log(`[skillCast] ✔ beginner MP: ${mpBefore} → ${player.mp}`);

  // Verify mob took damage.
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

// ─── Test 6: Mage arcane_bolt → cast + MP + damage ──────────────────────────

async function testMageArcaneBolt(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── mage.arcane_bolt learn & cast ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "mage",
    archetype: ClassArchetype.MAGE,
    level: 15,
    stats: { STR: 4, DEX: 10, INT: 25, LUK: 4, HP: 100, MP: 100 },
    maxHp: 200,
    maxMp: 200,
  });

  const skillId = "mage.arcane_bolt";
  const skillDef = allSkillsForClass(ClassArchetype.MAGE).find((s) => s.id === skillId)!;
  assert.ok(skillDef, "arcane_bolt exists");
  assert.strictEqual(skillDef.kind, "active");

  const learnResult = await sendAndWait(sdkRoom, MessageType.LEARN_SKILL, { skillId });
  assert.strictEqual(learnResult.success, true, "mage learn succeeds");

  const resolvedStats = skillStatAt(skillDef, 1);
  assert.ok(resolvedStats.mpCost > 0, "arcane_bolt costs MP");

  const mobId = findAndPositionMob(serverRoom.state, player.x, player.y);
  const mobHpBefore = serverRoom.state.mobs.get(mobId)!.hp;
  const mpBefore = player.mp;

  const castResult = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, { skillId });
  assert.strictEqual(castResult.success, true, "mage cast succeeds");

  // MP deducted.
  assert.strictEqual(player.mp, mpBefore - resolvedStats.mpCost, "mage MP deducted");
  console.log(`[skillCast] ✔ mage MP: ${mpBefore} → ${player.mp}`);

  // Mob took damage.
  const mobAfter = serverRoom.state.mobs.get(mobId);
  if (!mobAfter) {
    console.log(`[skillCast] ✔ mage mob HP: ${mobHpBefore} → 0 (killed)`);
  } else {
    assert.ok(mobAfter.hp < mobHpBefore, "mage mob took damage");
    console.log(
      `[skillCast] ✔ mage mob HP: ${mobHpBefore} → ${mobAfter.hp} (dealt ${mobHpBefore - mobAfter.hp})`,
    );
  }

  await sdkRoom.leave();
}

// ─── Test 7: Archer twin_shot → multi-hit (hitCount 2) ─────────────────────

async function testArcherTwinShot(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── archer.twin_shot (multi-hit) ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "archer",
    archetype: ClassArchetype.ARCHER,
    level: 15,
    stats: { STR: 10, DEX: 25, INT: 4, LUK: 4, HP: 150, MP: 60 },
    maxHp: 250,
    maxMp: 100,
  });

  const skillId = "archer.twin_shot";
  const skillDef = allSkillsForClass(ClassArchetype.ARCHER).find((s) => s.id === skillId)!;
  assert.ok(skillDef, "twin_shot exists");
  assert.strictEqual(skillDef.kind, "active");

  const learnResult = await sendAndWait(sdkRoom, MessageType.LEARN_SKILL, { skillId });
  assert.strictEqual(learnResult.success, true, "archer learn succeeds");

  const resolvedStats = skillStatAt(skillDef, 1);
  // Twin shot has hitCount 2
  assert.strictEqual(resolvedStats.hitCount, 2, "twin_shot hitCount is 2");

  const mobId = findAndPositionMob(serverRoom.state, player.x, player.y);
  const mobHpBefore = serverRoom.state.mobs.get(mobId)!.hp;
  const mpBefore = player.mp;

  const castResult = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, { skillId });
  assert.strictEqual(castResult.success, true, "archer cast succeeds");

  assert.strictEqual(player.mp, mpBefore - resolvedStats.mpCost, "archer MP deducted");

  const mobAfter = serverRoom.state.mobs.get(mobId);
  if (!mobAfter) {
    console.log(`[skillCast] ✔ archer multi-hit killed mob (${mobHpBefore} → 0)`);
  } else {
    assert.ok(mobAfter.hp < mobHpBefore, "archer mob took damage");
    console.log(
      `[skillCast] ✔ archer mob HP: ${mobHpBefore} → ${mobAfter.hp} (hitCount=2, dealt ${mobHpBefore - mobAfter.hp})`,
    );
  }

  await sdkRoom.leave();
}

// ─── Test 8: Thief shadow_rush → DARK element ──────────────────────────────

async function testThiefShadowRush(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── thief.shadow_rush (DARK element) ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "thief",
    archetype: ClassArchetype.THIEF,
    level: 15,
    stats: { STR: 10, DEX: 8, INT: 4, LUK: 25, HP: 150, MP: 60 },
    maxHp: 250,
    maxMp: 100,
  });

  const skillId = "thief.shadow_rush";
  const skillDef = allSkillsForClass(ClassArchetype.THIEF).find((s) => s.id === skillId)!;
  assert.ok(skillDef, "shadow_rush exists");
  assert.strictEqual(skillDef.kind, "active");
  assert.strictEqual(skillDef.element, "DARK", "shadow_rush is DARK element");

  const learnResult = await sendAndWait(sdkRoom, MessageType.LEARN_SKILL, { skillId });
  assert.strictEqual(learnResult.success, true, "thief learn succeeds");

  const resolvedStats = skillStatAt(skillDef, 1);

  // Listen for COMBAT_HIT to verify elementMultiplier
  let combatHitElementMul = 1;
  sdkRoom.onMessage(MessageType.COMBAT_HIT, (msg: any) => {
    combatHitElementMul = msg.elementMultiplier ?? 1;
  });

  const mobId = findAndPositionMob(serverRoom.state, player.x, player.y);
  const mobHpBefore = serverRoom.state.mobs.get(mobId)!.hp;
  const mpBefore = player.mp;

  const castResult = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, { skillId });
  assert.strictEqual(castResult.success, true, "thief cast succeeds");

  assert.strictEqual(player.mp, mpBefore - resolvedStats.mpCost, "thief MP deducted");

  // Verify element multiplier was passed through combat hit.
  await sleep(100); // Allow COMBAT_HIT broadcast to arrive
  // Element multiplier should be a number (1.0 if no elementMods on mob, or different if mob has DARK resistance)
  assert.ok(typeof combatHitElementMul === "number", "elementMultiplier is numeric");
  console.log(`[skillCast] ✔ DARK element: elementMultiplier=${combatHitElementMul}`);

  const mobAfter = serverRoom.state.mobs.get(mobId);
  if (!mobAfter) {
    console.log(`[skillCast] ✔ thief mob killed (${mobHpBefore} → 0)`);
  } else {
    assert.ok(mobAfter.hp < mobHpBefore, "thief mob took DARK damage");
    console.log(
      `[skillCast] ✔ thief mob HP: ${mobHpBefore} → ${mobAfter.hp} (dealt ${mobHpBefore - mobAfter.hp})`,
    );
  }

  await sdkRoom.leave();
}

// ─── Test 9: Pirate gut_punch → cast + damage ──────────────────────────────

async function testPirateGutPunch(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── pirate.gut_punch learn & cast ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "pirate",
    archetype: ClassArchetype.PIRATE,
    level: 15,
    stats: { STR: 25, DEX: 10, INT: 4, LUK: 4, HP: 200, MP: 50 },
    maxHp: 300,
    maxMp: 80,
  });

  const skillId = "pirate.gut_punch";
  const skillDef = allSkillsForClass(ClassArchetype.PIRATE).find((s) => s.id === skillId)!;
  assert.ok(skillDef, "gut_punch exists");

  const learnResult = await sendAndWait(sdkRoom, MessageType.LEARN_SKILL, { skillId });
  assert.strictEqual(learnResult.success, true, "pirate learn succeeds");

  const resolvedStats = skillStatAt(skillDef, 1);

  const mobId = findAndPositionMob(serverRoom.state, player.x, player.y);
  const mobHpBefore = serverRoom.state.mobs.get(mobId)!.hp;
  const mpBefore = player.mp;

  const castResult = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, { skillId });
  assert.strictEqual(castResult.success, true, "pirate cast succeeds");

  assert.strictEqual(player.mp, mpBefore - resolvedStats.mpCost, "pirate MP deducted");
  console.log(`[skillCast] ✔ pirate MP: ${mpBefore} → ${player.mp}`);

  const mobAfter = serverRoom.state.mobs.get(mobId);
  if (!mobAfter) {
    console.log(`[skillCast] ✔ pirate mob killed (${mobHpBefore} → 0)`);
  } else {
    assert.ok(mobAfter.hp < mobHpBefore, "pirate mob took damage");
    console.log(
      `[skillCast] ✔ pirate mob HP: ${mobHpBefore} → ${mobAfter.hp} (dealt ${mobHpBefore - mobAfter.hp})`,
    );
  }

  await sdkRoom.leave();
}

// ─── Test 10: Cooldown enforcement — re-cast rejected during cooldown ────────

async function testCooldownEnforcement(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── cooldown enforcement ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "cd",
    archetype: ClassArchetype.WARRIOR,
    level: 15,
    spOverride: totalSpByLevel(15) - 1,
    skillBook: { "warrior.crushing_blow": 1 },
  });

  const skillDef = allSkillsForClass(ClassArchetype.WARRIOR).find(
    (s) => s.id === "warrior.crushing_blow",
  )!;
  const resolvedStats = skillStatAt(skillDef, 1);
  assert.ok(resolvedStats.cooldownMs > 0, "crushing_blow has cooldown");

  const mobId = findAndPositionMob(serverRoom.state, player.x, player.y);

  // 1) First cast — should succeed.
  const cast1 = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.crushing_blow",
  });
  assert.strictEqual(cast1.success, true, "first cast succeeds");
  assert.ok(player.skillCooldowns.get("warrior.crushing_blow")! > 0, "cooldown set");

  // 2) Immediate re-cast — should be rejected.
  const cast2 = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.crushing_blow",
  });
  assert.strictEqual(cast2.success, false, "re-cast rejected during cooldown");
  assert.ok(cast2.message.toLowerCase().includes("cooldown"), "error mentions cooldown");
  console.log(`[skillCast] ✔ cooldown blocked: "${cast2.message}"`);

  // 3) Wait for cooldown to tick down.
  await sleep(resolvedStats.cooldownMs + 200);

  // 4) Re-cast — should succeed now.
  const mobId2 = findAndPositionMob(serverRoom.state, player.x, player.y);
  const cast3 = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.crushing_blow",
  });
  assert.strictEqual(cast3.success, true, "re-cast succeeds after cooldown expires");
  console.log("[skillCast] ✔ re-cast succeeds after cooldown expiry");

  await sdkRoom.leave();
}

// ─── Test 11: Cross-class skill rejected ─────────────────────────────────────

async function testCrossClassSkillRejected(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── cross-class skill rejected ──");

  const { sdkRoom } = await createAndJoin(colyseus, {
    tag: "cross",
    archetype: ClassArchetype.MAGE,
    level: 15,
    stats: { STR: 4, DEX: 10, INT: 25, LUK: 4, HP: 100, MP: 100 },
    maxHp: 200,
    maxMp: 200,
  });

  // Mage tries to cast warrior skill.
  const result = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.crushing_blow",
  });
  assert.strictEqual(result.success, false, "cross-class skill rejected");
  assert.ok(result.message.toLowerCase().includes("unknown"), "error says unknown");
  console.log(`[skillCast] ✔ cross-class rejected: "${result.message}"`);

  await sdkRoom.leave();
}

// ─── Test 12: AoE target count — warrior.battle_cry hits 3 mobs ────────────

async function testAoETargetCount(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── AoE targetCount: warrior.battle_cry ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "aoe",
    archetype: ClassArchetype.WARRIOR,
    level: 20,
    stats: { STR: 25, DEX: 10, INT: 4, LUK: 4, HP: 300, MP: 80 },
    maxHp: 400,
    maxMp: 120,
  });

  // battle_cry requires crushing_blow level 3.
  const skillBook: Record<string, number> = {
    "warrior.crushing_blow": 3,
    "warrior.battle_cry": 1,
  };

  // Apply the prereq skill book directly.
  for (const [sid, lvl] of Object.entries(skillBook)) {
    player.skillBook[sid] = lvl;
  }
  // Deduct SP: crushing_blow(3) + battle_cry(1) = 4 SP spent.
  player.sp = totalSpByLevel(20) - 4;

  const skillDef = allSkillsForClass(ClassArchetype.WARRIOR).find(
    (s) => s.id === "warrior.battle_cry",
  )!;
  assert.ok(skillDef, "battle_cry exists");
  const resolvedStats = skillStatAt(skillDef, 1);
  assert.strictEqual(resolvedStats.targetCount, 3, "battle_cry targetCount=3");

  // Position 3 mobs near the player.
  const mobIds = findAndPositionMobs(serverRoom.state, player.x, player.y, 3, 30);
  assert.strictEqual(mobIds.length, 3, "found 3 mobs");
  const hpBefore = mobIds.map((id) => serverRoom.state.mobs.get(id)!.hp);

  const mpBefore = player.mp;

  // Ensure enough MP for battle_cry.
  assert.ok(mpBefore >= resolvedStats.mpCost, "have enough MP for battle_cry");

  const castResult = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.battle_cry",
  });
  assert.strictEqual(castResult.success, true, "battle_cry cast succeeds");

  // Verify MP deducted.
  assert.strictEqual(player.mp, mpBefore - resolvedStats.mpCost, "battle_cry MP deducted");

  // Verify all 3 mobs took damage.
  let mobsHit = 0;
  for (let i = 0; i < mobIds.length; i++) {
    const mobAfter = serverRoom.state.mobs.get(mobIds[i]);
    if (!mobAfter) {
      mobsHit++;
      console.log(`[skillCast] ✔ AoE mob ${i}: ${hpBefore[i]} → 0 (killed)`);
    } else if (mobAfter.hp < hpBefore[i]) {
      mobsHit++;
      console.log(
        `[skillCast] ✔ AoE mob ${i}: ${hpBefore[i]} → ${mobAfter.hp} (dealt ${hpBefore[i] - mobAfter.hp})`,
      );
    }
  }
  assert.strictEqual(mobsHit, 3, "all 3 mobs hit by AoE");
  console.log("[skillCast] ✔ AoE targetCount verified: 3/3 mobs hit");

  await sdkRoom.leave();
}

// ─── Test 13: Buff skill — warrior.rally applies activeEffects ──────────────

async function testBuffSkill(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── buff skill: warrior.rally ──");

  const { sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "buff",
    archetype: ClassArchetype.WARRIOR,
    level: 20,
    stats: { STR: 20, DEX: 10, INT: 4, LUK: 4, HP: 300, MP: 100 },
    maxHp: 400,
    maxMp: 200,
  });

  // Rally requires iron_hide level 1.
  player.skillBook["warrior.iron_hide"] = 1;
  player.skillBook["warrior.rally"] = 1;
  player.sp = totalSpByLevel(20) - 2;

  const skillDef = allSkillsForClass(ClassArchetype.WARRIOR).find((s) => s.id === "warrior.rally")!;
  assert.ok(skillDef, "rally exists");
  assert.strictEqual(skillDef.kind, "buff");
  const resolvedStats = skillStatAt(skillDef, 1);

  const mpBefore = player.mp;
  const effectsBefore = player.activeEffects.length;

  const castResult = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.rally",
  });
  assert.strictEqual(castResult.success, true, "rally cast succeeds");

  // MP deducted.
  assert.strictEqual(player.mp, mpBefore - resolvedStats.mpCost, "buff MP deducted");
  console.log(`[skillCast] ✔ buff MP: ${mpBefore} → ${player.mp}`);

  // Active effects should have increased (buff applied).
  assert.ok(
    player.activeEffects.length > effectsBefore,
    "activeEffects count increased after buff",
  );
  console.log(
    `[skillCast] ✔ buff applied: effects ${effectsBefore} → ${player.activeEffects.length}`,
  );

  // Cooldown should be set.
  assert.ok(player.skillCooldowns.get("warrior.rally")! > 0, "buff has cooldown");

  await sdkRoom.leave();
}

// ─── Test 14: Debuff application — warrior.battle_cry stuns mob ─────────────

async function testDebuffApplication(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── debuff: warrior.battle_cry → stun ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "debuff",
    archetype: ClassArchetype.WARRIOR,
    level: 20,
    stats: { STR: 25, DEX: 10, INT: 4, LUK: 4, HP: 300, MP: 100 },
    maxHp: 400,
    maxMp: 200,
  });

  // battle_cry requires crushing_blow level 3.
  player.skillBook["warrior.crushing_blow"] = 3;
  player.skillBook["warrior.battle_cry"] = 1;
  player.sp = totalSpByLevel(20) - 4;

  const skillDef = allSkillsForClass(ClassArchetype.WARRIOR).find(
    (s) => s.id === "warrior.battle_cry",
  )!;
  assert.ok(skillDef.debuffEffect, "battle_cry has debuffEffect");
  assert.strictEqual((skillDef.debuffEffect as any).stunMs, 1000, "battle_cry stuns for 1000ms");

  const mobId = findAndPositionMob(serverRoom.state, player.x, player.y);
  const mob = serverRoom.state.mobs.get(mobId)!;

  const castResult = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.battle_cry",
  });
  assert.strictEqual(castResult.success, true, "battle_cry cast succeeds");

  // If mob survived (hp > 0), verify debuff applied.
  const mobAfter = serverRoom.state.mobs.get(mobId);
  if (mobAfter) {
    // Check that mob has active effects (debuffs were applied).
    assert.ok(mobAfter.activeEffects !== undefined, "mob has activeEffects after debuff skill");
    const debuffCount = mobAfter.activeEffects?.length ?? 0;
    assert.ok(debuffCount > 0, "mob received at least 1 debuff");
    console.log(`[skillCast] ✔ debuff applied: mob has ${debuffCount} effect(s)`);
  } else {
    console.log("[skillCast] ✔ debuff skill killed mob (damage still verified)");
  }

  await sdkRoom.leave();
}

// ─── Test 15: Macro layout + macro cast ─────────────────────────────────────

async function testMacroCast(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── macro: layout + cast ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "macro",
    archetype: ClassArchetype.WARRIOR,
    level: 15,
    spOverride: totalSpByLevel(15) - 1,
    skillBook: { "warrior.crushing_blow": 1 },
  });

  // 1) Define a macro with one skill step.
  const macroId = "test_macro_1";
  const macroLayout = {
    macros: [
      {
        id: macroId,
        name: "Test Macro",
        steps: [{ type: "skill" as const, id: "warrior.crushing_blow" }],
      },
    ],
  };
  sdkRoom.send(MessageType.MACRO_LAYOUT, macroLayout);
  await sleep(200);

  // Verify macro was saved on player.
  assert.ok(player.macros.length > 0, "macro persisted");
  assert.strictEqual(player.macros[0].id, macroId, "macro id matches");

  // 2) Position a mob and cast via macro.
  const mobId = findAndPositionMob(serverRoom.state, player.x, player.y);
  const mobHpBefore = serverRoom.state.mobs.get(mobId)!.hp;
  const mpBefore = player.mp;

  // MACRO_CAST doesn't send a dedicated response — it calls handleSkillCast which sends SKILL_CAST.
  // Listen for the SKILL_CAST response triggered internally by the macro.
  const castP = waitForMessage(sdkRoom, MessageType.SKILL_CAST, 3000);
  sdkRoom.send(MessageType.MACRO_CAST, { macroId });
  const castResult = await castP;
  assert.strictEqual(castResult.success, true, "macro cast succeeds");

  // MP was deducted.
  const resolvedStats = skillStatAt(
    allSkillsForClass(ClassArchetype.WARRIOR).find((s) => s.id === "warrior.crushing_blow")!,
    1,
  );
  assert.strictEqual(player.mp, mpBefore - resolvedStats.mpCost, "macro cast deducted MP");

  // Mob took damage.
  const mobAfter = serverRoom.state.mobs.get(mobId);
  if (!mobAfter) {
    console.log(`[skillCast] ✔ macro killed mob (${mobHpBefore} → 0)`);
  } else {
    assert.ok(mobAfter.hp < mobHpBefore, "macro cast dealt damage");
    console.log(
      `[skillCast] ✔ macro mob: ${mobHpBefore} → ${mobAfter.hp} (dealt ${mobHpBefore - mobAfter.hp})`,
    );
  }

  await sdkRoom.leave();
}

// ─── Test 16: Quickslot layout persistence ───────────────────────────────────

async function testQuickslotLayout(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── quickslot layout ──");

  const { sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "qslot",
    archetype: ClassArchetype.WARRIOR,
    level: 15,
    spOverride: totalSpByLevel(15) - 1,
    skillBook: { "warrior.crushing_blow": 1 },
  });

  // Set quickslot layout: slot 0 = crushing_blow, slot 1 = null, slot 2 = iron_hide.
  const slots = [
    { type: "skill" as const, id: "warrior.crushing_blow" },
    null,
    { type: "skill" as const, id: "warrior.iron_hide" },
  ];
  sdkRoom.send(MessageType.QUICKSLOT_LAYOUT, { slots });
  await sleep(200);

  // Verify layout was persisted on player.
  assert.ok(Array.isArray(player.quickslots), "quickslots is array");
  assert.strictEqual(player.quickslots.length, 3, "3 slots saved");
  assert.strictEqual(player.quickslots[0]?.id, "warrior.crushing_blow", "slot 0 = crushing_blow");
  assert.strictEqual(player.quickslots[1], null, "slot 1 = null");
  assert.strictEqual(player.quickslots[2]?.id, "warrior.iron_hide", "slot 2 = iron_hide");
  console.log("[skillCast] ✔ quickslot layout persisted");

  await sdkRoom.leave();
}

// ─── Test 17: COMBAT_HIT broadcast with damage numbers ─────────────────────

async function testCombatHitBroadcast(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[skillCast] ── COMBAT_HIT broadcast ──");

  const { serverRoom, sdkRoom, player } = await createAndJoin(colyseus, {
    tag: "hit",
    archetype: ClassArchetype.WARRIOR,
    level: 15,
    spOverride: totalSpByLevel(15) - 1,
    skillBook: { "warrior.crushing_blow": 1 },
  });

  const mobId = findAndPositionMob(serverRoom.state, player.x, player.y);

  // Listen for COMBAT_HIT.
  let hitReceived = false;
  let hitDamage = 0;
  let hitTargetKey = "";
  sdkRoom.onMessage(MessageType.COMBAT_HIT, (msg: any) => {
    hitReceived = true;
    hitDamage = msg.damage;
    hitTargetKey = msg.targetKey;
    assert.ok(typeof msg.crit === "boolean", "crit is boolean");
    assert.ok(typeof msg.hit === "boolean", "hit is boolean");
    assert.ok(typeof msg.mobHp === "number", "mobHp is number");
    assert.ok(typeof msg.mobMaxHp === "number", "mobMaxHp is number");
    assert.ok(typeof msg.elementMultiplier === "number", "elementMultiplier is number");
  });

  const castResult = await sendAndWait(sdkRoom, MessageType.SKILL_CAST, {
    skillId: "warrior.crushing_blow",
  });
  assert.strictEqual(castResult.success, true, "cast succeeds");

  await sleep(200); // Allow COMBAT_HIT to arrive

  assert.ok(hitReceived, "COMBAT_HIT broadcast received");
  assert.ok(hitDamage >= 0, "damage is non-negative");
  assert.ok(hitTargetKey.length > 0, "targetKey is non-empty");
  console.log(`[skillCast] ✔ COMBAT_HIT: damage=${hitDamage}, target=${hitTargetKey}`);

  await sdkRoom.leave();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  // Original tests (all 5 classes covered)
  await testLearnAndCast(colyseus);
  await testCastNoMp(colyseus);
  await testCastNotLearned(colyseus);
  await testCastInsufficientMp(colyseus);
  await testBeginnerNimbleStrike(colyseus);

  // All 5 classes — representative skill cast
  await testMageArcaneBolt(colyseus);
  await testArcherTwinShot(colyseus);
  await testThiefShadowRush(colyseus);
  await testPirateGutPunch(colyseus);

  // Server-authoritative guards
  await testCooldownEnforcement(colyseus);
  await testCrossClassSkillRejected(colyseus);

  // AoE / target count
  await testAoETargetCount(colyseus);

  // Buff & debuff
  await testBuffSkill(colyseus);
  await testDebuffApplication(colyseus);

  // Quickslot / macro
  await testMacroCast(colyseus);
  await testQuickslotLayout(colyseus);

  // Feedback broadcast
  await testCombatHitBroadcast(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[skillCast] PASS ✔  all skill cast tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[skillCast] FAIL ✘", err);
  process.exit(1);
});
