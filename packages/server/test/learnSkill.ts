/**
 * SP / Skill Learning test — verifies the learnSkill server handler:
 *   1. Valid learn: a level-10 WARRIOR spends 1 SP → skill book updated, SP decremented.
 *   2. Over-spend: after exhausting SP budget, further learns are rejected.
 *   3. Tier-gate: a level-10 WARRIOR cannot learn a tier-2 skill (level 30 req).
 *
 * Run: npx tsx test/learnSkill.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype, spSpent, totalSpByLevel } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[learnSkill] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function waitForLearnResult(sdkRoom: any, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`LEARN_SKILL result was not received within ${timeoutMs}ms`));
    }, timeoutMs);
    sdkRoom.onMessage(MessageType.LEARN_SKILL, (message: any) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

async function setupLevel10Warrior(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
  label: string,
  spOverride?: number,
) {
  const accountId = `learn_skill_test_${label}_${Date.now()}`;
  const rec = accountStore.createCharacter(accountId, {
    name: `SkillTest${label}`,
    archetype: ClassArchetype.WARRIOR,
    appearance: {
      gender: "M",
      skinId: "skin_0",
      hairId: "hair_0",
      hairColorId: "hc_0",
      faceId: "face_0",
      outfitId: "outfit_0",
    },
  });

  const sp = spOverride ?? totalSpByLevel(10); // 27 for level 10
  accountStore.updateCharacter(rec.charId, {
    level: 10,
    exp: 0,
    ap: 45,
    sp,
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
  assert.ok(player, "player should exist after join");
  assert.strictEqual(player.archetype, ClassArchetype.WARRIOR);
  assert.strictEqual(player.level, 10);

  return { serverRoom, sdkRoom, player };
}

// ─── Test 1: Valid learn ─────────────────────────────────────────────────────

async function testValidLearn(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[learnSkill] ── valid learn: warrior.crushing_blow ──");

  const { sdkRoom, player } = await setupLevel10Warrior(colyseus, "valid");

  assert.strictEqual(player.sp, totalSpByLevel(10), "should have full SP");
  assert.deepStrictEqual(player.skillBook, {}, "book starts empty");

  const promise = waitForLearnResult(sdkRoom);
  sdkRoom.send(MessageType.LEARN_SKILL, { skillId: "warrior.crushing_blow" });
  const result = await promise;

  assert.strictEqual(result.success, true, "learn should succeed");
  assert.strictEqual(result.skillId, "warrior.crushing_blow");
  assert.strictEqual(result.sp, totalSpByLevel(10) - 1, "SP decremented by 1");
  assert.ok(result.book, "result should include book");
  assert.strictEqual(result.book["warrior.crushing_blow"], 1, "skill level 1 in book");

  // Server-side state
  assert.strictEqual(player.sp, totalSpByLevel(10) - 1);
  assert.strictEqual(player.skillBook["warrior.crushing_blow"], 1);
  assert.strictEqual(spSpent(player.skillBook), 1);

  console.log(
    `[learnSkill] ✔ valid learn: sp=${player.sp}, book=${JSON.stringify(player.skillBook)}`,
  );

  await sdkRoom.leave();
}

// ─── Test 2: Over-spend rejection ────────────────────────────────────────────

async function testOverSpend(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[learnSkill] ── over-spend rejection ──");

  const { sdkRoom, player } = await setupLevel10Warrior(colyseus, "overspend");

  // Spend all SP by filling the book directly (simulates many learns).
  // totalSpByLevel(10) = 27. Put 20 into crushing_blow, 7 into iron_hide.
  const budget = totalSpByLevel(10);
  const fakeBook: Record<string, number> = {
    "warrior.crushing_blow": 20,
    "warrior.iron_hide": 7,
  };
  assert.strictEqual(spSpent(fakeBook), budget, "fake book exhausts budget");

  // Apply the full book + zero SP to the player.
  player.skillBook = fakeBook;
  player.sp = 0;
  accountStore.updateCharacter(player.charId, { skillBook: fakeBook, sp: 0 });

  // Attempt to learn another skill — should be rejected.
  const promise = waitForLearnResult(sdkRoom);
  sdkRoom.send(MessageType.LEARN_SKILL, { skillId: "warrior.rally" });
  const result = await promise;

  assert.strictEqual(result.success, false, "over-spend should be rejected");
  assert.ok(result.message, "should have error message");

  // Book and SP unchanged.
  assert.deepStrictEqual(player.skillBook, fakeBook, "book unchanged");
  assert.strictEqual(player.sp, 0, "SP still 0");
  assert.strictEqual(spSpent(player.skillBook), budget);

  console.log(`[learnSkill] ✔ over-spend rejected: "${result.message}"`);

  await sdkRoom.leave();
}

// ─── Test 3: Tier-gate rejection ─────────────────────────────────────────────

async function testTierGate(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[learnSkill] ── tier-gate rejection ──");

  const { sdkRoom, player } = await setupLevel10Warrior(colyseus, "tiergate");

  // warrior.cleave is tier 2, levelReq 30 — a level-10 cannot learn it.
  const promise = waitForLearnResult(sdkRoom);
  sdkRoom.send(MessageType.LEARN_SKILL, { skillId: "warrior.cleave" });
  const result = await promise;

  assert.strictEqual(result.success, false, "tier-gated skill should be rejected");
  assert.ok(result.message, "should have error message");

  // Book and SP unchanged.
  assert.deepStrictEqual(player.skillBook, {}, "book unchanged");
  assert.strictEqual(player.sp, totalSpByLevel(10), "SP unchanged");

  console.log(`[learnSkill] ✔ tier-gate rejected: "${result.message}"`);

  await sdkRoom.leave();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testValidLearn(colyseus);
  await testOverSpend(colyseus);
  await testTierGate(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[learnSkill] PASS ✔  all skill learning tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[learnSkill] FAIL ✘", err);
  process.exit(1);
});
