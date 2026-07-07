/**
 * Metrics & operability test — proves `/metrics` is accurate under load (CCU, where
 * players are per-map/per-channel) and that the active party / guild / trade / market
 * listing counts reflect live state. Also verifies `/admin/status` and `/metrics` are
 * secret-gated.
 *
 * Run: npx tsx test/metrics.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { ClassArchetype } from "@maple/shared";
import { accountStore, marketStore } from "../src/persistence/store";
import { partyManager } from "../src/partyManager";
import { guildManager } from "../src/guildManager";
import { tradeRegistry } from "../src/tradeRegistry";
import { MessageType } from "../src/types";
import { signToken, newGuestAccountId } from "../src/auth";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[metrics] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

const APPEARANCE = {
  gender: "M",
  skinId: "skin_0",
  hairId: "hair_0",
  hairColorId: "hc_0",
  faceId: "face_0",
  outfitId: "outfit_0",
};

interface HttpResult {
  status: number;
  data: any;
  headers: Record<string, string>;
}

const MONITOR = "test-monitor-secret";
const ADMIN = "test-admin-secret";

async function main(): Promise<void> {
  process.env.MONITOR_SECRET = MONITOR;
  process.env.ADMIN_SECRET = ADMIN;
  const colyseus = await boot(appConfig);

  // ── HTTP helper: never throw on 4xx/5xx. ──────────────────────────────────
  const http = async (
    method: "get" | "post",
    path: string,
    opts: { monitorToken?: string; adminToken?: string } = {},
  ): Promise<HttpResult> => {
    const headers: Record<string, string> = {};
    if (opts.monitorToken) headers["x-monitor-token"] = opts.monitorToken;
    if (opts.adminToken) headers["x-admin-token"] = opts.adminToken;
    try {
      const res = await (colyseus.http as any)[method](path, { headers });
      return {
        status: res.statusCode,
        data: res.data,
        headers: (res.headers as Record<string, string>) ?? {},
      };
    } catch (err) {
      const e = err as { statusCode?: number; data?: any; headers?: Record<string, string> };
      return { status: e.statusCode ?? 0, data: e.data ?? {}, headers: e.headers ?? {} };
    }
  };

  // Mint a token-bearing join helper (mirrors a real authed client).
  const join = async (roomName: string, charId: string, accountId: string) => {
    return (colyseus.sdk as any).joinOrCreate(roomName, {
      charId,
      accountId,
      token: signToken(accountId),
    });
  };

  // ── 1) Secret gating ──────────────────────────────────────────────────────
  const noMonitorToken = await http("get", "/metrics");
  assert.strictEqual(noMonitorToken.status, 401, "1) /metrics rejects without MONITOR_SECRET");
  const wrongMonitor = await http("get", "/metrics", { monitorToken: "nope" });
  assert.strictEqual(wrongMonitor.status, 401, "1) /metrics rejects wrong token");
  const metricsOk = await http("get", "/metrics", { monitorToken: MONITOR });
  assert.strictEqual(metricsOk.status, 200, "1) /metrics ok with token");

  const noAdmin = await http("get", "/admin/status");
  assert.strictEqual(noAdmin.status, 401, "1) /admin/status rejects without ADMIN_SECRET");
  console.log("[metrics] 1 PASS ✔  /metrics + /admin/status secret-gated");

  // ── 2) Baseline: empty server ─────────────────────────────────────────────
  let m = metricsOk.data;
  assert.strictEqual(m.playersOnline, 0, "2) empty: 0 in-world players");
  assert.strictEqual(m.activeTrades, 0, "2) empty: 0 active trades");
  assert.ok(Array.isArray(m.topMaps), "2) topMaps is an array");
  assert.ok(m.uptimeMs >= 0, "2) uptimeMs present");
  console.log("[metrics] 2 PASS ✔  baseline empty snapshot");

  // ── 3) Population accuracy under load ─────────────────────────────────────
  // 2 players on dawn_isle ch0, 1 player on meadowfield ch1.
  const mkChar = (acct: string, name: string) => {
    accountStore.getOrCreate(acct);
    return accountStore.createCharacter(acct, {
      name,
      archetype: ClassArchetype.BEGINNER,
      appearance: APPEARANCE,
    });
  };
  const a1 = newGuestAccountId();
  const a2 = newGuestAccountId();
  const a3 = newGuestAccountId();
  const c1 = mkChar(a1, "PopHeroOne");
  const c2 = mkChar(a2, "PopHeroTwo");
  const c3 = mkChar(a3, "PopHeroThree");

  const r1 = await join("dawn_isle__ch0", c1.charId, a1);
  const r2 = await join("dawn_isle__ch0", c2.charId, a2);
  await sleep(150);
  const r3 = await join("meadowfield__ch1", c3.charId, a3);
  await sleep(300);

  m = (await http("get", "/metrics", { monitorToken: MONITOR })).data;
  assert.strictEqual(m.playersOnline, 3, "3) 3 in-world players");
  assert.strictEqual(m.population["dawn_isle"], 2, "3) dawn_isle has 2");
  assert.strictEqual(m.population["meadowfield"], 1, "3) meadowfield has 1");

  const dawn = m.topMaps.find((t: any) => t.mapId === "dawn_isle");
  assert.ok(dawn, "3) dawn_isle in topMaps");
  assert.strictEqual(dawn.players, 2, "3) dawn_isle topMap players = 2");
  const ch0 = dawn.channels.find((c: any) => c.channel === 0);
  assert.strictEqual(ch0.players, 2, "3) dawn_isle ch0 = 2");
  const ch1 = dawn.channels.find((c: any) => c.channel === 1);
  assert.strictEqual(ch1.players, 0, "3) dawn_isle ch1 = 0");
  assert.strictEqual(m.topMaps[0].mapId, "dawn_isle", "3) most-populated map first");
  // matchMaker CCU should be ≥ in-world count (also counts these room clients).
  assert.ok(m.ccu >= 3, `3) ccu ${m.ccu} >= 3`);
  console.log(
    `[metrics] 3 PASS ✔  population accurate (ccu=${m.ccu}, in-world=3, dawn=2/ch0, mead=1/ch1)`,
  );

  // Leave one → counts drop.
  await r2.leave();
  await sleep(300);
  m = (await http("get", "/metrics", { monitorToken: MONITOR })).data;
  assert.strictEqual(m.playersOnline, 2, "3b) 2 after one leaves");
  assert.strictEqual(m.population["dawn_isle"], 1, "3b) dawn_isle drops to 1");
  console.log("[metrics] 3b PASS ✔  population drops on leave");

  // ── 4) Active trades counted ────────────────────────────────────────────────
  // Re-join a 2nd player to dawn_isle ch0 and open a trade.
  const ta = newGuestAccountId();
  const tb = newGuestAccountId();
  const cta = mkChar(ta, "TradeAlpha");
  const ctb = mkChar(tb, "TradeBeta");
  accountStore.setMesos(cta.charId, 1000);
  accountStore.setMesos(ctb.charId, 1000);
  const ra = await join("meadowfield", cta.charId, ta);
  const rb = await join("meadowfield", ctb.charId, tb);
  await sleep(300);

  ra.send(MessageType.TRADE_INVITE, { targetSessionId: rb.sessionId });
  await sleep(150);
  rb.send(MessageType.TRADE_ACCEPT, { fromSessionId: ra.sessionId });
  await sleep(250);

  assert.strictEqual(tradeRegistry.activeCount, 1, "4) tradeRegistry sees 1 open trade");
  m = (await http("get", "/metrics", { monitorToken: MONITOR })).data;
  assert.strictEqual(m.activeTrades, 1, "4) /metrics reports 1 active trade");

  // Cancel it → count returns to 0.
  rb.send(MessageType.TRADE_CANCEL, {});
  await sleep(250);
  assert.strictEqual(tradeRegistry.activeCount, 0, "4b) trade closed in registry");
  m = (await http("get", "/metrics", { monitorToken: MONITOR })).data;
  assert.strictEqual(m.activeTrades, 0, "4b) /metrics reports 0 active trades after cancel");
  console.log("[metrics] 4 PASS ✔  active trades counted (1 → 0 on cancel)");

  // ── 5) Parties, guilds, market listings counted ─────────────────────────────
  // Guild (directly via the manager — exactly what the room does).
  const beforeGuilds = guildManager.guildCount;
  const gRes = guildManager.createGuild(cta.charId, "TradeAlpha", 1, "MetricsGuild", 5);
  assert.ok(typeof gRes !== "string", "5) guild created");
  assert.strictEqual(guildManager.guildCount, beforeGuilds + 1, "5) guildCount +1");

  // Party: invite + accept (players are online via their room registrations).
  const beforeParties = partyManager.activePartyCount;
  const invErr = partyManager.invite(cta.charId, "TradeAlpha", "TradeBeta");
  assert.ok(!invErr, `5) party invite ok: ${invErr}`);
  const acc = partyManager.accept(ctb.charId, "TradeBeta", 1, "meadowfield", cta.charId);
  assert.ok(typeof acc !== "string", "5) party accept ok");
  assert.strictEqual(partyManager.activePartyCount, beforeParties + 1, "5) activePartyCount +1");

  // Market listing.
  const beforeListings = marketStore.all().length;
  marketStore.add({
    sellerId: cta.charId,
    sellerName: "TradeAlpha",
    item: {
      uid: "metrics_item_1",
      defId: "wpn.iron_broadsword",
      baseRank: "NORMAL",
      potentialTier: "RARE",
      lines: 1,
      minted: false,
    },
    price: 500,
    listingType: "fixed",
    endsAt: 0,
    currentBid: 0,
    highBidderCharId: "",
  });

  m = (await http("get", "/metrics", { monitorToken: MONITOR })).data;
  assert.strictEqual(m.guildCount, beforeGuilds + 1, "5) /metrics guildCount");
  assert.strictEqual(m.activeParties, beforeParties + 1, "5) /metrics activeParties");
  assert.strictEqual(m.marketListings, beforeListings + 1, "5) /metrics marketListings");
  assert.ok(typeof m.buyOrders === "number", "5) buyOrders present");
  console.log(
    `[metrics] 5 PASS ✔  guilds=${m.guildCount} parties=${m.activeParties} listings=${m.marketListings}`,
  );

  // ── 6) /admin/status renders HTML with live data ────────────────────────────
  const status = await http("get", "/admin/status", { adminToken: ADMIN });
  assert.strictEqual(status.status, 200, "6) /admin/status 200");
  const ct = status.headers["content-type"] ?? status.headers["Content-Type"] ?? "";
  assert.match(ct, /html/i, "6) content-type is html");
  const html: string = typeof status.data === "string" ? status.data : JSON.stringify(status.data);
  assert.match(html, /Live Status/, "6) has title");
  assert.match(html, /dawn_isle|meadowfield/i, "6) shows a populated map");
  // Parties/guilds/cards are numeric on the dashboard.
  assert.match(html, /Parties/, "6) has Parties card");
  assert.match(html, /Guilds/, "6) has Guilds card");
  console.log("[metrics] 6 PASS ✔  /admin/status renders live HTML dashboard");

  // ── cleanup ──────────────────────────────────────────────────────────────
  await r1.leave();
  await r3.leave();
  await ra.leave();
  await rb.leave();
  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[metrics] PASS ✔  all metrics & operability tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[metrics] FAIL ✘", err);
  process.exit(1);
});
