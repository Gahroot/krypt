/**
 * Runtime smoke test — boots rooms in-process via @colyseus/testing, joins as a Warrior,
 * marches into a mob while swinging, and verifies the authoritative combat/reward loop fires.
 * Also verifies that non-Meadowfield maps (e.g. dawn_isle) load and spawn mobs from shared data.
 * Run: npx tsx test/smoke.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import { MAPS } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard watchdog so the process can never hang a harness. The meadowfield combat
// phase runs ~1280 fixed ticks (~20s of real sleeps) plus per-tick SDK message
// processing; under host load that loop can stretch well past a minute, so give
// the watchdog generous headroom. This only guards against a true hang — it does
// not relax any of the gameplay assertions below.
const watchdog = setTimeout(() => {
  console.error("[smoke] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 180_000);

async function testMeadowfield(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[smoke] ── meadowfield ──");
  const room = await colyseus.sdk.joinOrCreate("meadowfield", { name: "Smoke" });
  // Swallow the per-tick boss HP broadcast (Meadowfield's Mano field boss). With
  // no handler the SDK logs an "onMessage not registered" warning every tick, and
  // that synchronous console spam noticeably slows the long combat loop below.
  room.onMessage("boss_hp", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200); // let the first state patch arrive

  const sessionId = room.sessionId;
  const me = () => (room.state as any).players.get(sessionId);
  assert.ok(me(), "player should exist in state after join");
  assert.strictEqual((room.state as any).mapId, "meadowfield", "mapId should be meadowfield");

  const mobCount = (room.state as any).mobs.size;
  assert.ok(mobCount > 0, "mobs should be spawned");
  console.log(`[smoke] joined; players=${(room.state as any).players.size} mobs=${mobCount}`);

  const startMesos = me().mesos;
  const startExp = me().exp;

  // Home in on the nearest mob, stand on it, and swing until something dies.
  // A beginner (no weapon) deals 1 dmg per hit; meadow slimes have 30 HP.
  // At 450 ms cooldown we need ~34+ attacks → 1280 ticks × 16 ms ≈ 20 s.
  const firstMobId = Array.from((room.state as any).mobs.keys())[0] as string;
  let tick = 0;
  for (let i = 0; i < 1280; i++) {
    const mob = (room.state as any).mobs.get(firstMobId);
    const px = me().x;
    const mx = mob ? mob.x : px;
    room.send(MessageType.INPUT, {
      left: px > mx + 28,
      right: px < mx - 28,
      up: false,
      down: false,
      attack: true,
      interact: false,
      tick: tick++,
    });
    await sleep(16);
  }
  await sleep(200);

  const p = me();
  const mob = (room.state as any).mobs.get(firstMobId);
  console.log(
    `[smoke] after combat: mesos ${startMesos}→${p.mesos}, exp ${startExp}→${p.exp}, ` +
      `inv=${p.inventory.size}, loot-on-ground=${(room.state as any).loot.size}, ` +
      `nearestMobHp=${mob ? mob.hp : "?"}/${mob ? mob.maxHp : "?"} px=${Math.round(p.x)}`,
  );

  assert.ok(
    p.mesos > startMesos || p.exp > startExp,
    "killing a mob should award mesos and/or exp (authoritative reward path)",
  );

  await room.leave();
}

async function testDawnIsle(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[smoke] ── dawn_isle ──");
  const room = await colyseus.sdk.joinOrCreate("dawn_isle", { name: "SmokeDI" });
  await sleep(200);

  const sessionId = room.sessionId;
  const me = () => (room.state as any).players.get(sessionId);
  assert.ok(me(), "player should exist in dawn_isle state after join");
  assert.strictEqual((room.state as any).mapId, "dawn_isle", "mapId should be dawn_isle");

  const mobCount = (room.state as any).mobs.size;
  assert.ok(mobCount > 0, "dawn_isle should have mobs spawned from map data");
  console.log(`[smoke] dawn_isle: players=${(room.state as any).players.size} mobs=${mobCount}`);

  // Verify mob IDs match dawn_isle spawns (friendly_snail, green_puff, dawn_shroom).
  const mobIds = new Set<string>();
  for (const mob of (room.state as any).mobs.values()) {
    mobIds.add(mob.mobId);
  }
  console.log("[smoke] dawn_isle mob types:", [...mobIds].join(", "));
  assert.ok(mobIds.has("mob.friendly_snail"), "dawn_isle should spawn friendly_snail mobs");

  // Verify map dimensions in room state match the authoritative shared map data
  // (single source of truth) rather than hard-coded literals that can go stale.
  const dawnIsle = MAPS.dawn_isle;
  assert.ok(dawnIsle, "dawn_isle should exist in shared MAPS data");
  assert.strictEqual(
    (room.state as any).mapWidth,
    dawnIsle.width,
    `dawn_isle width should match shared data (${dawnIsle.width})`,
  );
  assert.strictEqual(
    (room.state as any).mapHeight,
    dawnIsle.height,
    `dawn_isle height should match shared data (${dawnIsle.height})`,
  );

  await room.leave();
}

async function main() {
  const colyseus = await boot(appConfig);

  await testMeadowfield(colyseus);
  await testDawnIsle(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[smoke] PASS ✔  all zones verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] FAIL ✘", err);
  process.exit(1);
});
