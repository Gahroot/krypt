/**
 * Runtime smoke test — boots the room in-process via @colyseus/testing, joins as a Warrior,
 * marches into a mob while swinging, and verifies the authoritative combat/reward loop fires.
 * Run: npx tsx test/smoke.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard watchdog so the process can never hang a harness.
const watchdog = setTimeout(() => {
  console.error("[smoke] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

async function main() {
  const colyseus = await boot(appConfig);
  const room = await colyseus.sdk.joinOrCreate("town_room", { name: "Smoke" });
  await sleep(200); // let the first state patch arrive

  const sessionId = room.sessionId;
  const me = () => (room.state as any).players.get(sessionId);
  assert.ok(me(), "player should exist in state after join");

  const mobCount = (room.state as any).mobs.size;
  assert.ok(mobCount > 0, "mobs should be spawned");
  console.log(`[smoke] joined; players=${(room.state as any).players.size} mobs=${mobCount}`);

  const startMesos = me().mesos;
  const startExp = me().exp;

  // Home in on the nearest mob, stand on it, and swing until something dies.
  const firstMobId = Array.from((room.state as any).mobs.keys())[0] as string;
  let tick = 0;
  for (let i = 0; i < 320; i++) {
    const mob = (room.state as any).mobs.get(firstMobId);
    const px = me().x;
    const mx = mob ? mob.x : px;
    room.send(MessageType.INPUT, {
      left: px > mx + 28,
      right: px < mx - 28,
      up: false,
      down: false,
      attack: true,
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
  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[smoke] PASS ✔  authoritative combat + reward loop works");
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] FAIL ✘", err);
  process.exit(1);
});
