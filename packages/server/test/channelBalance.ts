/**
 * Channel load-balancing test — proves the channel system actually load-balances:
 * when a channel is full (at MapRoom.maxClients), matchmaking routes a new joiner
 * to another channel of the same map, the `/channels` UI data reflects real
 * population + FULL state, and no room ever exceeds maxClients.
 *
 * Run: npx tsx test/channelBalance.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import appConfig, { CHANNELS_PER_MAP, MAP_ROOM_MAX_CLIENTS } from "../src/app.config";
import { ClassArchetype } from "@maple/shared";
import { accountStore } from "../src/persistence/store";
import { channelRegistry } from "../src/channelRegistry";
import { MessageType } from "../src/types";
import { signToken } from "../src/auth";
import type { ChannelSwitchResultPayload } from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The full ch0 fill is real but bounded; allow plenty of headroom.
const watchdog = setTimeout(() => {
  console.error("[channelBalance] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 120_000);

const APPEARANCE = {
  gender: "M",
  skinId: "skin_0",
  hairId: "hair_0",
  hairColorId: "hc_0",
  faceId: "face_0",
  outfitId: "outfit_0",
};

const MAP = "meadowfield";

interface HttpResult {
  status: number;
  data: any;
}

async function main(): Promise<void> {
  const colyseus = await boot(appConfig);

  // ── HTTP helper: never throw on 4xx/5xx. ──────────────────────────────────
  const http = async (path: string): Promise<HttpResult> => {
    try {
      const res = await (colyseus.http as any).get(path, { headers: {} });
      return { status: res.statusCode, data: res.data };
    } catch (err) {
      const e = err as { statusCode?: number; data?: any };
      return { status: e.statusCode ?? 0, data: e.data ?? {} };
    }
  };

  // Mint a token-bearing join helper (mirrors a real authed client).
  const join = async (roomName: string, charId: string, accountId: string) =>
    (colyseus.sdk as any).joinOrCreate(roomName, {
      charId,
      accountId,
      token: signToken(accountId),
    });

  // ── 1) Fill channel 0 to exactly maxClients. ──────────────────────────────
  console.log(`[channelBalance] ── filling ${MAP}__ch0 to capacity (${MAP_ROOM_MAX_CLIENTS}) ──`);
  const rooms: { leave: () => Promise<unknown> }[] = [];
  for (let i = 0; i < MAP_ROOM_MAX_CLIENTS; i++) {
    const acct = `bal_acct_${i}`;
    const rec = accountStore.createCharacter(acct, {
      name: `Balancer${i}`,
      archetype: ClassArchetype.BEGINNER,
      appearance: APPEARANCE,
    });
    const room = await join(`${MAP}__ch0`, rec.charId, acct);
    rooms.push(room as { leave: () => Promise<unknown> });
  }
  // Give the registry's onJoin registrations a tick to settle.
  await sleep(150);

  // ── 2) Registry counts are accurate: ch0 is full, others empty. ───────────
  const counts = channelRegistry.getChannelCounts(MAP, CHANNELS_PER_MAP, MAP_ROOM_MAX_CLIENTS);
  assert.strictEqual(counts[0].playerCount, MAP_ROOM_MAX_CLIENTS, "ch0 should be full");
  assert.strictEqual(counts[0].full, true, "ch0 should report full=true");
  assert.strictEqual(counts[1].playerCount, 0, "ch1 should be empty");
  assert.ok(
    channelRegistry.isChannelFull(MAP, 0, MAP_ROOM_MAX_CLIENTS),
    "isChannelFull(ch0) should be true",
  );
  assert.ok(
    !channelRegistry.isChannelFull(MAP, 1, MAP_ROOM_MAX_CLIENTS),
    "isChannelFull(ch1) should be false",
  );
  console.log(
    `[channelBalance] ✔ ch0 full (${counts[0].playerCount}/${MAP_ROOM_MAX_CLIENTS}), ch1/ch2 empty — counts accurate`,
  );

  // ── 3) `/channels` reflects live population + FULL + recommendation. ──────
  const chRes = await http(`/channels?mapId=${MAP}`);
  assert.strictEqual(chRes.status, 200, "/channels should be 200");
  assert.strictEqual(chRes.data.maxClients, MAP_ROOM_MAX_CLIENTS, "/channels reports maxClients");
  const ch0 = chRes.data.channels[0];
  assert.strictEqual(ch0.playerCount, MAP_ROOM_MAX_CLIENTS, "/channels ch0 playerCount");
  assert.strictEqual(ch0.full, true, "/channels ch0 full=true");
  assert.strictEqual(ch0.maxClients, MAP_ROOM_MAX_CLIENTS, "/channels ch0 maxClients");
  assert.notStrictEqual(
    chRes.data.recommendedChannel,
    0,
    "/channels should NOT recommend the full ch0",
  );
  console.log(
    `[channelBalance] ✔ /channels live: ch0 ${ch0.playerCount}/${ch0.maxClients} FULL, recommended ch${chRes.data.recommendedChannel}`,
  );

  // ── 4) `/join-channel` load-balances: a new joiner lands in ch1/ch2, not ch0.
  const joinRes = await http(`/join-channel?mapId=${MAP}`);
  assert.strictEqual(joinRes.status, 200, "/join-channel should be 200");
  assert.notStrictEqual(joinRes.data.channel, 0, "should not place on full ch0");
  assert.strictEqual(
    joinRes.data.roomName,
    `${MAP}__ch${joinRes.data.channel}`,
    "roomName should be explicit channel name",
  );
  // `prefer` for a full channel must still be redirected to a non-full one.
  const preferFull = await http(`/join-channel?mapId=${MAP}&prefer=0`);
  assert.strictEqual(preferFull.status, 200, "/join-channel prefer=0 should still 200");
  assert.notStrictEqual(preferFull.data.channel, 0, "prefer full ch0 must redirect");
  console.log(
    `[channelBalance] ✔ /join-channel routed to ch${joinRes.data.channel} (prefer=0 → ch${preferFull.data.channel})`,
  );

  // ── 5) A real joiner lands on the resolved channel and ch0 stays capped. ──
  const overflowAcct = "bal_overflow";
  const overflowRec = accountStore.createCharacter(overflowAcct, {
    name: "Overflower",
    archetype: ClassArchetype.BEGINNER,
    appearance: APPEARANCE,
  });
  const overflowRoom = (await join(joinRes.data.roomName, overflowRec.charId, overflowAcct)) as {
    sessionId: string;
    leave: () => Promise<unknown>;
  };
  await sleep(150);
  const after = channelRegistry.getChannelCounts(MAP, CHANNELS_PER_MAP, MAP_ROOM_MAX_CLIENTS);
  assert.strictEqual(after[0].playerCount, MAP_ROOM_MAX_CLIENTS, "ch0 still capped at maxClients");
  assert.strictEqual(
    after[joinRes.data.channel].playerCount,
    1,
    "overflower landed on the routed channel",
  );
  const me = () => (overflowRoom as any).state?.players?.get(overflowRoom.sessionId);
  assert.ok(me(), "overflower should exist in the routed channel room");
  console.log(
    `[channelBalance] ✔ overflower landed on ch${joinRes.data.channel}; ch0 still exactly ${after[0].playerCount} (not exceeded)`,
  );

  // ── 6) Channel-switch into a FULL channel is rejected server-side. ────────
  let switchResult: ChannelSwitchResultPayload | null = null;
  (overflowRoom as any).onMessage(
    MessageType.CHANNEL_SWITCH_RESULT,
    (msg: ChannelSwitchResultPayload) => {
      switchResult = msg;
    },
  );
  // Try to switch into the full ch0.
  (overflowRoom as any).send(MessageType.CHANNEL_SWITCH, { channel: 0 });
  await sleep(300);
  assert.ok(switchResult, "should receive CHANNEL_SWITCH_RESULT");
  assert.strictEqual(switchResult!.success, false, "switch into full ch0 must be rejected");
  assert.ok(switchResult!.reason, "rejected switch should carry a reason");
  // The overflower must still be on the routed channel (not moved).
  assert.strictEqual(
    channelRegistry.getBySessionId(overflowRoom.sessionId)?.channel,
    joinRes.data.channel,
    "rejected switch must not move the player",
  );
  console.log(
    `[channelBalance] ✔ CHANNEL_SWITCH into full ch0 rejected: "${switchResult!.reason}"`,
  );

  // Cleanup.
  await overflowRoom.leave();
  await Promise.all(rooms.map((r) => r.leave().catch(() => undefined)));
  await sleep(100);
  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[channelBalance] PASS ✔  channel load-balancing verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[channelBalance] FAIL ✘", err);
  process.exit(1);
});
