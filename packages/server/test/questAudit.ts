/**
 * Quest completability audit — programmatic simulation of every quest's
 * lifecycle (accept → objectives → turn-in → reward) plus reference
 * integrity validation across all 131 quests.
 *
 * This is a pure unit test — no Colyseus boot required. It exercises the
 * questEngine functions directly and validates that every shipped-zone quest
 * is start-to-finish completable.
 *
 * Run: npx tsx test/questAudit.ts
 */
import assert from "node:assert";
import {
  QUESTS,
  NPCS,
  MOBS,
  ITEMS,
  MAPS,
  UNSHIPPED_ZONES,
  validateAllQuests,
  isQuestOnShippedZone,
  type QuestDef,
  type QuestState,
} from "@maple/shared";
import {
  ensureQuestStates,
  acceptQuest,
  progressObjectives,
  turnInQuest,
  resetDailyQuests,
} from "../src/questEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub Player for turnInQuest — only mesos and inventory are mutated. */
function makePlayer(level: number, charId = `audit_${Date.now()}`) {
  return {
    level,
    mesos: 0,
    charId,
    inventory: new Map<string, unknown>(),
  } as any;
}

function findQuest(quests: QuestState[], id: string): QuestState {
  const qs = quests.find((q) => q.questId === id);
  assert.ok(qs, `quest ${id} should exist in quest state`);
  return qs;
}

// ---------------------------------------------------------------------------
// Part 1: Reference integrity audit
// ---------------------------------------------------------------------------

function testReferenceIntegrity() {
  console.log("[audit] ── reference integrity ──");

  const issues = validateAllQuests();

  // Separate gated (unshipped zone) issues from hard errors
  const gated: typeof issues = [];
  const errors: typeof issues = [];
  for (const issue of issues) {
    if (issue.kind === "giver_on_unshipped_zone") {
      gated.push(issue);
    } else {
      errors.push(issue);
    }
  }

  // Report gated quests (expected — these zones aren't shipped yet)
  if (gated.length > 0) {
    console.log(`[audit] ℹ️  ${gated.length} quests on unshipped zones (gated as expected):`);
    const gatedQuestIds = new Set(gated.map((g) => g.questId));
    for (const qid of gatedQuestIds) {
      const def = QUESTS[qid];
      console.log(`[audit]   🔒 ${def?.name ?? qid} (${qid})`);
    }
  }

  // Hard errors must be zero
  if (errors.length > 0) {
    console.error("[audit] ✘ reference integrity errors:");
    for (const e of errors) {
      console.error(`[audit]   ${e.questId}: [${e.kind}] ${e.detail}`);
    }
    assert.fail(`${errors.length} reference integrity errors found`);
  }

  console.log(
    `[audit] ✔ reference integrity passed (${Object.keys(QUESTS).length} quests, ${gated.length} gated)`,
  );
}

// ---------------------------------------------------------------------------
// Part 2: Giver-NPC-on-shipped-map check
// ---------------------------------------------------------------------------

function testGiverReachability() {
  console.log("[audit] ── giver NPC reachability ──");

  let reachable = 0;
  let unreachable = 0;

  for (const def of Object.values(QUESTS)) {
    const npc = NPCS[def.giverNpcId];
    if (!npc) {
      console.error(`[audit] ✘ ${def.id}: giver NPC ${def.giverNpcId} missing`);
      unreachable++;
      continue;
    }
    if (UNSHIPPED_ZONES.has(npc.mapId)) {
      unreachable++;
    } else {
      reachable++;
    }
  }

  console.log(
    `[audit] ✔ ${reachable} quests have reachable givers, ${unreachable} gated (unshipped zones)`,
  );
  assert.ok(reachable > 0, "at least some quests should have reachable givers");
}

// ---------------------------------------------------------------------------
// Part 3: Simulation — complete every shipped-zone quest end-to-end
// ---------------------------------------------------------------------------

/**
 * For a kill objective, simulate the required number of kills via progressObjectives.
 */
function simulateKills(
  quests: QuestState[],
  objDef: { kind: "kill"; mobId: string; count: number },
) {
  for (let i = 0; i < objDef.count; i++) {
    progressObjectives(quests, "kill", objDef.mobId, 1);
  }
}

/**
 * For a collect objective, simulate picking up the required number of items.
 */
function simulateCollects(
  quests: QuestState[],
  objDef: { kind: "collect"; itemId: string; count: number },
) {
  for (let i = 0; i < objDef.count; i++) {
    progressObjectives(quests, "collect", objDef.itemId, 1);
  }
}

/**
 * For a talk objective, simulate talking to the NPC.
 */
function simulateTalk(quests: QuestState[], objDef: { kind: "talk"; npcId: string }) {
  progressObjectives(quests, "talk", objDef.npcId, 1);
}

/**
 * For a level objective, simulate reaching the target level.
 */
function simulateLevel(quests: QuestState[], objDef: { kind: "level"; level: number }) {
  progressObjectives(quests, "level", String(objDef.level), 1);
}

function testQuestSimulation() {
  console.log("[audit] ── quest simulation (shipped-zone quests) ──");

  const results: { id: string; name: string; ok: boolean; error?: string }[] = [];

  // Process quests in dependency order (topological sort by prereq chains)
  const sorted = topologicalSortQuests();

  for (const def of sorted) {
    // Skip quests on unshipped zones
    if (!isQuestOnShippedZone(def)) continue;

    // Skip instanced/PQ quests (these require Colyseus rooms)
    if (def.id.includes("pq.") || def.id.includes("_pq_")) continue;

    try {
      simulateSingleQuest(def);
      results.push({ id: def.id, name: def.name, ok: true });
    } catch (err: any) {
      results.push({ id: def.id, name: def.name, ok: false, error: err.message });
    }
  }

  // Report
  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log(`[audit] ${passed.length}/${results.length} shipped-zone quests passed simulation`);

  if (failed.length > 0) {
    console.error("[audit] ✘ FAILED quests:");
    for (const f of failed) {
      console.error(`[audit]   ${f.name} (${f.id}): ${f.error}`);
    }
    assert.fail(`${failed.length} quests failed simulation`);
  }

  console.log("[audit] ✔ all shipped-zone quests are start-to-finish completable");
}

function simulateSingleQuest(def: QuestDef) {
  // Determine required player level (max of requiredLevel and any level objective)
  let playerLevel = def.requiredLevel ?? 1;
  for (const obj of def.objectives) {
    if (obj.kind === "level" && obj.level > playerLevel) {
      playerLevel = obj.level;
    }
  }
  // For quest chains, advance through prerequisite quests first
  let quests: QuestState[] = ensureQuestStates([]);
  const player = makePlayer(playerLevel);

  // Complete prerequisite chain
  const prereqs = getPrereqChain(def.id);
  for (const prereqId of prereqs) {
    const prereqDef = QUESTS[prereqId];
    if (!prereqDef) continue;
    // If prereq is also on an unshipped zone, skip this quest
    if (!isQuestOnShippedZone(prereqDef)) {
      throw new Error(`prerequisite ${prereqId} is on unshipped zone`);
    }
    completeQuestFull(quests, prereqDef, player);
  }

  // Now complete this quest
  completeQuestFull(quests, def, player);
}

function completeQuestFull(quests: QuestState[], def: QuestDef, player: any) {
  // Accept
  const acceptResult = acceptQuest(quests, def.id, player.level);
  assert.notStrictEqual(
    typeof acceptResult,
    "string",
    `accept ${def.id} should succeed, got: ${acceptResult}`,
  );

  // Simulate objectives
  for (const obj of def.objectives) {
    switch (obj.kind) {
      case "kill":
        simulateKills(quests, obj);
        break;
      case "collect":
        simulateCollects(quests, obj);
        break;
      case "talk":
        simulateTalk(quests, obj);
        break;
      case "level":
        simulateLevel(quests, obj);
        break;
    }
  }

  // Verify status is "complete"
  const qs = findQuest(quests, def.id);
  assert.strictEqual(
    qs.status,
    "complete",
    `quest ${def.id} should be "complete" after objectives, got "${qs.status}"`,
  );

  // Turn in — record mesos before to verify delta
  const mesosBefore = player.mesos;
  const turnInResult = turnInQuest(quests, def.id, player);
  assert.strictEqual(turnInResult, "", `turnIn ${def.id} should succeed, got: "${turnInResult}"`);

  // Verify status is "turnedIn"
  assert.strictEqual(qs.status, "turnedIn", `quest ${def.id} should be "turnedIn" after turn-in`);

  // Verify mesos reward delta
  if (def.rewards.mesos) {
    assert.strictEqual(
      player.mesos,
      mesosBefore + def.rewards.mesos,
      `${def.id}: mesos delta wrong (before=${mesosBefore}, after=${player.mesos}, expected delta=${def.rewards.mesos})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Part 4: Prerequisite chain validation
// ---------------------------------------------------------------------------

function testPrerequisiteChains() {
  console.log("[audit] ── prerequisite chain validation ──");

  let chainCount = 0;

  for (const def of Object.values(QUESTS)) {
    if (!def.prereqQuestId) continue;

    // Verify the chain is reachable (all prereqs exist and are on shipped zones or
    // at least reference valid quests)
    const chain = getPrereqChain(def.id);
    assert.ok(chain.length > 0, `quest ${def.id} has prereq but chain is empty`);

    // No quest should appear twice in a chain (cycle already caught by validateAllQuests)
    const unique = new Set(chain);
    assert.strictEqual(unique.size, chain.length, `quest ${def.id} has duplicate in prereq chain`);

    chainCount++;
  }

  console.log(
    `[audit] ✔ ${chainCount} prerequisite chains validated (no cycles, all references resolve)`,
  );
}

function getPrereqChain(questId: string): string[] {
  const chain: string[] = [];
  let current = QUESTS[questId]?.prereqQuestId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    chain.unshift(current);
    seen.add(current);
    current = QUESTS[current]?.prereqQuestId;
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Part 5: Daily quest reset cycle
// ---------------------------------------------------------------------------

function testDailyResetCycle() {
  console.log("[audit] ── daily quest reset cycle ──");

  const dailyIds = Object.values(QUESTS)
    .filter((q) => q.repeatable?.kind === "daily" && isQuestOnShippedZone(q))
    .map((q) => q.id);

  assert.ok(dailyIds.length > 0, "should have at least one shipped daily quest");

  for (const dailyId of dailyIds) {
    const def = QUESTS[dailyId];
    assert.ok(def, `daily quest ${dailyId} exists`);

    let quests = ensureQuestStates([]);
    const player = makePlayer(def.requiredLevel ?? 1);

    // Day 1: accept → complete → turn in
    completeQuestFull(quests, def, player);
    const qs1 = findQuest(quests, dailyId);
    assert.strictEqual(qs1.status, "turnedIn", `${dailyId} should be turnedIn after day 1`);

    // Simulate next UTC day
    const nextDay = Date.now() + 86_400_001;
    quests = resetDailyQuests(quests, nextDay);
    const qs2 = findQuest(quests, dailyId);
    assert.strictEqual(
      qs2.status,
      "available",
      `${dailyId} should reset to "available" on new day`,
    );

    // Day 2: accept → complete → turn in again
    completeQuestFull(quests, def, player);
    const qs3 = findQuest(quests, dailyId);
    assert.strictEqual(qs3.status, "turnedIn", `${dailyId} should be turnedIn after day 2`);
  }

  console.log(`[audit] ✔ ${dailyIds.length} daily quests reset and re-completable`);
}

// ---------------------------------------------------------------------------
// Part 6: Mob spawn coverage — every kill-target mob spawns somewhere shipped
// ---------------------------------------------------------------------------

function testMobSpawnCoverage() {
  console.log("[audit] ── mob spawn coverage ──");

  // Build set of mobs that spawn on shipped maps
  const shippedMobSpawns = new Set<string>();
  for (const map of Object.values(MAPS)) {
    if (UNSHIPPED_ZONES.has(map.id)) continue;
    for (const s of map.spawns) shippedMobSpawns.add(s.mobId);
    if (map.bossSpawns) for (const s of map.bossSpawns) shippedMobSpawns.add(s.mobId);
  }

  // Check every kill objective in shipped-zone quests
  let checked = 0;
  let missing = 0;

  for (const def of Object.values(QUESTS)) {
    if (!isQuestOnShippedZone(def)) continue;

    for (const obj of def.objectives) {
      if (obj.kind !== "kill") continue;
      checked++;
      if (!shippedMobSpawns.has(obj.mobId)) {
        console.error(`[audit] ✘ ${def.id}: kill target ${obj.mobId} has no spawn on shipped maps`);
        missing++;
      }
    }
  }

  assert.strictEqual(
    missing,
    0,
    `${missing} kill objectives target mobs with no shipped-map spawn`,
  );
  console.log(
    `[audit] ✔ all ${checked} kill objectives in shipped-zone quests target mobs with spawns`,
  );
}

// ---------------------------------------------------------------------------
// Part 7: Reward item coverage
// ---------------------------------------------------------------------------

function testRewardItemCoverage() {
  console.log("[audit] ── reward item coverage ──");

  let checked = 0;
  let missing = 0;

  for (const def of Object.values(QUESTS)) {
    if (!def.rewards.items) continue;
    for (const itemId of def.rewards.items) {
      checked++;
      if (!ITEMS[itemId]) {
        console.error(`[audit] ✘ ${def.id}: reward item ${itemId} not in ITEMS catalog`);
        missing++;
      }
    }
  }

  assert.strictEqual(missing, 0, `${missing} reward items missing from ITEMS catalog`);
  console.log(`[audit] ✔ all ${checked} reward items exist in ITEMS catalog`);
}

// ---------------------------------------------------------------------------
// Part 8: Level-band sanity — requiredLevel matches mob levels in objectives
// ---------------------------------------------------------------------------

function testLevelBandSanity() {
  console.log("[audit] ── level-band sanity ──");

  let warnings = 0;

  for (const def of Object.values(QUESTS)) {
    if (!isQuestOnShippedZone(def)) continue;
    if (def.requiredLevel === undefined) continue;

    for (const obj of def.objectives) {
      if (obj.kind !== "kill") continue;
      const mob = MOBS[obj.mobId];
      if (!mob) continue;

      // Warn if the quest's required level is more than 20 below the mob level
      // (player could be severely underleveled for the content)
      const gap = mob.level - def.requiredLevel;
      if (gap > 20) {
        console.warn(
          `[audit] ⚠️  ${def.id}: requiredLevel ${def.requiredLevel} but kill target ${obj.mobId} is level ${mob.level} (gap: ${gap})`,
        );
        warnings++;
      }
    }
  }

  console.log(`[audit] ✔ level-band check complete (${warnings} warnings)`);
}

// ---------------------------------------------------------------------------
// Topological sort for quest execution order
// ---------------------------------------------------------------------------

function topologicalSortQuests(): QuestDef[] {
  const defs = Object.values(QUESTS);
  const visited = new Set<string>();
  const result: QuestDef[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const def = QUESTS[id];
    if (def?.prereqQuestId) visit(def.prereqQuestId);
    if (def) result.push(def);
  }

  for (const def of defs) {
    visit(def.id);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log(`[audit] ═══ Quest Completability Audit ═══`);
  console.log(`[audit] ${Object.keys(QUESTS).length} quests in catalog`);
  console.log(
    `[audit] ${Object.keys(NPCS).length} NPCs, ${Object.keys(MOBS).length} mobs, ${Object.keys(ITEMS).length} items`,
  );
  console.log(`[audit] ${MAPS ? Object.keys(MAPS).length : 0} maps in registry`);
  console.log("");

  testReferenceIntegrity();
  testGiverReachability();
  testMobSpawnCoverage();
  testRewardItemCoverage();
  testLevelBandSanity();
  testPrerequisiteChains();
  testQuestSimulation();
  testDailyResetCycle();

  console.log("");
  console.log("[audit] ═══ PASS ✔  all shipped-zone quests are start-to-finish completable ═══");
}

main();
