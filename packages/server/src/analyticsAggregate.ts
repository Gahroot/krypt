/**
 * Analytics aggregation script — computes alpha-success metrics from the event log.
 *
 * Run with:  pnpm --filter @maple/server tsx src/analyticsAggregate.ts
 *
 * Outputs:
 *   1. Onboarding funnel: created → Lv10 → 1st job → Lv30 → 2nd job
 *   2. D1 retention (Day-1 return rate)
 *   3. Time-to-level distribution
 *   4. Per-map disconnect heatmap
 *   5. Boss kill / PQ stats
 *
 * Reads directly from SQLite (same DB the server uses). Safe to run while the server is up
 * (WAL mode provides concurrent reads).
 */

import { AnalyticsStore } from "./persistence/analyticsStore";
import { AnalyticsEventType } from "./analyticsEvents";

// ─── Helpers ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

function pct(num: number, den: number): string {
  if (den === 0) return "0.0%";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  const midVal = sorted[mid] ?? 0;
  if (sorted.length % 2 === 0) {
    const prevVal = sorted[mid - 1] ?? 0;
    return (prevVal + midVal) / 2;
  }
  return midVal;
}

function p95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const store = new AnalyticsStore();
  const events = store.all();

  if (events.length === 0) {
    console.log("No analytics events found. Run the server first to collect data.");
    return;
  }

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const timeRange =
    firstEvent && lastEvent
      ? `${new Date(firstEvent.createdAt).toISOString()} → ${new Date(lastEvent.createdAt).toISOString()}`
      : "N/A";

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  CryptoMaple Alpha Analytics Report");
  console.log(`  Events: ${events.length.toLocaleString()}  |  Range: ${timeRange}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── Build account timelines ─────────────────────────────────────────────

  /** accountId → sorted events. */
  const byAccount = new Map<string, typeof events>();
  for (const ev of events) {
    let arr = byAccount.get(ev.accountId);
    if (!arr) {
      arr = [];
      byAccount.set(ev.accountId, arr);
    }
    arr.push(ev);
  }

  const totalAccounts = byAccount.size;

  // ── Onboarding funnel ──────────────────────────────────────────────────

  const created = new Set<string>();
  const lv10 = new Set<string>();
  const firstJob = new Set<string>();
  const lv30 = new Set<string>();
  const secondJob = new Set<string>();

  /** Track earliest timestamp per milestone for time-to-level. */
  const createdTs = new Map<string, number>();
  const levelTs = new Map<string, Map<number, number>>(); // accountId → level → timestamp

  for (const [acct, acctEvents] of byAccount) {
    for (const ev of acctEvents) {
      if (ev.eventType === AnalyticsEventType.ACCOUNT_CREATED) {
        created.add(acct);
        if (!createdTs.has(acct)) createdTs.set(acct, ev.createdAt);
      }
      if (ev.eventType === AnalyticsEventType.LEVEL_UP) {
        const lvl = ev.payload.level as number;
        let acctLevelTs = levelTs.get(acct);
        if (!acctLevelTs) {
          acctLevelTs = new Map();
          levelTs.set(acct, acctLevelTs);
        }
        acctLevelTs.set(lvl, ev.createdAt);
        if (lvl >= 10) lv10.add(acct);
        if (lvl >= 30) lv30.add(acct);
      }
      if (ev.eventType === AnalyticsEventType.JOB_ADVANCE) {
        const tier = ev.payload.jobTier as number;
        if (tier === 1) firstJob.add(acct);
        if (tier === 2) secondJob.add(acct);
      }
    }
  }

  console.log("─── Onboarding Funnel ─────────────────────────────────────");
  console.log(`  Accounts created:   ${created.size}`);
  console.log(`  Reached Lv 10:      ${lv10.size}  (${pct(lv10.size, created.size)})`);
  console.log(`  1st job advance:    ${firstJob.size}  (${pct(firstJob.size, created.size)})`);
  console.log(`  Reached Lv 30:      ${lv30.size}  (${pct(lv30.size, created.size)})`);
  console.log(`  2nd job advance:    ${secondJob.size}  (${pct(secondJob.size, created.size)})`);

  // Where do players drop off?
  const dropoff10 = created.size - lv10.size;
  const dropoffJob1 = lv10.size - firstJob.size;
  const dropoff30 = firstJob.size - lv30.size;
  const dropoffJob2 = lv30.size - secondJob.size;
  console.log("\n  Drop-off breakdown:");
  console.log(
    `    Before Lv 10:     ${dropoff10} players (${pct(dropoff10, created.size)} of total)`,
  );
  console.log(
    `    Lv 10 → 1st job:  ${dropoffJob1} players (${pct(dropoffJob1, lv10.size)} of Lv10)`,
  );
  console.log(
    `    1st job → Lv 30:  ${dropoff30} players (${pct(dropoff30, firstJob.size)} of 1st job)`,
  );
  console.log(
    `    Lv 30 → 2nd job:  ${dropoffJob2} players (${pct(dropoffJob2, lv30.size)} of Lv30)`,
  );
  console.log();

  // ── Tutorial funnel ─────────────────────────────────────────────────────

  /**
   * Tutorial funnel: accounts that reached each Dawn Isle tutorial step.
   * Each step is a TUTORIAL_STEP event; the last step (completed=true) means
   * the player finished the tutorial and left for Heartland.
   */
  const tutorialStarted = new Set<string>();
  const tutorialComplete = new Set<string>();
  for (const ev of events) {
    if (ev.eventType === AnalyticsEventType.TUTORIAL_STEP) {
      tutorialStarted.add(ev.accountId);
      if (ev.payload.completed === true) tutorialComplete.add(ev.accountId);
    }
  }
  console.log("─── Tutorial Funnel (Dawn Isle) ─────────────────────────");
  console.log(
    `  Tutorial started:    ${tutorialStarted.size}  (${pct(tutorialStarted.size, created.size)} of accounts)`,
  );
  console.log(
    `  Tutorial complete:   ${tutorialComplete.size}  (${pct(tutorialComplete.size, tutorialStarted.size)} of starters)`,
  );
  console.log(
    `  Dropped during:      ${tutorialStarted.size - tutorialComplete.size}  (${pct(tutorialStarted.size - tutorialComplete.size, tutorialStarted.size)} of starters)`,
  );
  console.log();

  // ── D1 Retention ───────────────────────────────────────────────────────

  /**
   * D1 retention: % of accounts whose first session_start is ≥1 day before
   * their last session_start. This is a simplified "came back next day" metric.
   */
  const firstSessionTs = new Map<string, number>();
  const lastSessionTs = new Map<string, number>();

  for (const ev of events) {
    if (ev.eventType === AnalyticsEventType.SESSION_START) {
      const prev = firstSessionTs.get(ev.accountId);
      if (prev === undefined || ev.createdAt < prev) firstSessionTs.set(ev.accountId, ev.createdAt);
      const prevLast = lastSessionTs.get(ev.accountId);
      if (prevLast === undefined || ev.createdAt > prevLast)
        lastSessionTs.set(ev.accountId, ev.createdAt);
    }
  }

  let d1Return = 0;
  let d1Eligible = 0;
  for (const [acct, firstTs] of firstSessionTs) {
    const lastTs = lastSessionTs.get(acct);
    if (lastTs === undefined) continue;
    d1Eligible++;
    if (lastTs - firstTs >= MS_PER_DAY) d1Return++;
  }

  // D3 and D7 retention
  let d3Return = 0;
  let d3Eligible = 0;
  let d7Return = 0;
  let d7Eligible = 0;
  for (const [acct, firstTs] of firstSessionTs) {
    const lastTs = lastSessionTs.get(acct);
    if (lastTs === undefined) continue;
    d3Eligible++;
    if (lastTs - firstTs >= 3 * MS_PER_DAY) d3Return++;
    d7Eligible++;
    if (lastTs - firstTs >= 7 * MS_PER_DAY) d7Return++;
  }

  console.log("─── Retention ─────────────────────────────────────────────");
  console.log(`  D1:  ${d1Return} / ${d1Eligible}  (${pct(d1Return, d1Eligible)})`);
  console.log(`  D3:  ${d3Return} / ${d3Eligible}  (${pct(d3Return, d3Eligible)})`);
  console.log(`  D7:  ${d7Return} / ${d7Eligible}  (${pct(d7Return, d7Eligible)})`);
  console.log();

  // ── Time-to-Level (Lv 10, 30, 50) ────────────────────────────────────

  console.log("─── Time-to-Level ─────────────────────────────────────────");
  const targets = [10, 30, 50];
  for (const target of targets) {
    const times: number[] = [];
    for (const [acct, lvlMap] of levelTs) {
      const acctCreated = createdTs.get(acct);
      const reached = lvlMap.get(target);
      if (acctCreated !== undefined && reached !== undefined) {
        times.push(reached - acctCreated);
      }
    }
    times.sort((a, b) => a - b);
    if (times.length > 0) {
      const med = median(times);
      const p95v = p95(times);
      console.log(
        `  Lv ${target}:  n=${times.length}  median=${formatDuration(med)}  p95=${formatDuration(p95v)}`,
      );
    } else {
      console.log(`  Lv ${target}:  n=0 (no data)`);
    }
  }
  console.log();

  // ── Class popularity ───────────────────────────────────────────────────

  console.log("─── Class Distribution (1st-job choices) ───────────────────");
  const classCounts = new Map<string, number>();
  for (const ev of events) {
    if (ev.eventType === AnalyticsEventType.JOB_ADVANCE && (ev.payload.jobTier as number) === 1) {
      const cls = ev.payload.class as string;
      classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
    }
  }
  const sorted = [...classCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cls, count] of sorted) {
    console.log(`  ${cls}: ${count}`);
  }
  if (sorted.length === 0) console.log("  (no data)");
  console.log();

  // ── Churn analysis ─────────────────────────────────────────────────────

  /**
   * Churn: correlate disconnects with player progression stage.
   * "Where do players quit?" is answered by grouping disconnects by map + level.
   */
  console.log("─── Churn (Disconnects by Map + Level) ────────────────────");
  const churnByMapLevel = new Map<string, number>();
  for (const ev of events) {
    if (ev.eventType === AnalyticsEventType.DISCONNECT_BY_MAP) {
      const key = `${ev.payload.mapId} (Lv${ev.payload.level})`;
      churnByMapLevel.set(key, (churnByMapLevel.get(key) ?? 0) + 1);
    }
  }
  const sortedChurn = [...churnByMapLevel.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sortedChurn.slice(0, 15)) {
    console.log(`  ${key}: ${count}`);
  }
  if (sortedChurn.length === 0) console.log("  (no data)");
  console.log();

  // ── Disconnect-by-map heatmap ──────────────────────────────────────────

  console.log("─── Disconnect by Map ─────────────────────────────────────");
  const disconCounts = new Map<string, number>();
  for (const ev of events) {
    if (ev.eventType === AnalyticsEventType.DISCONNECT_BY_MAP) {
      const map = ev.payload.mapId as string;
      disconCounts.set(map, (disconCounts.get(map) ?? 0) + 1);
    }
  }
  const sortedDiscon = [...disconCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [map, count] of sortedDiscon.slice(0, 15)) {
    console.log(`  ${map}: ${count}`);
  }
  if (sortedDiscon.length === 0) console.log("  (no data)");
  console.log();

  // ── Boss kills & PQ runs ───────────────────────────────────────────────

  console.log("─── Boss Kills ────────────────────────────────────────────");
  const bossCounts = new Map<string, number>();
  for (const ev of events) {
    if (ev.eventType === AnalyticsEventType.BOSS_KILL) {
      const name = (ev.payload.name as string) ?? (ev.payload.mobId as string);
      bossCounts.set(name, (bossCounts.get(name) ?? 0) + 1);
    }
  }
  const sortedBoss = [...bossCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sortedBoss) {
    console.log(`  ${name}: ${count}`);
  }
  if (sortedBoss.length === 0) console.log("  (no data)");
  console.log();

  console.log("─── Party Quest Runs ──────────────────────────────────────");
  let pqSuccess = 0;
  let pqFail = 0;
  for (const ev of events) {
    if (ev.eventType === AnalyticsEventType.PARTY_QUEST_RUN) {
      if (ev.payload.success === true) pqSuccess++;
      else pqFail++;
    }
  }
  console.log(`  Success: ${pqSuccess}  |  Fail: ${pqFail}  |  Total: ${pqSuccess + pqFail}`);
  console.log();

  // ── Market stats ───────────────────────────────────────────────────────

  console.log("─── Market Activity ───────────────────────────────────────");
  let firstLists = 0;
  let firstBuys = 0;
  let sales = 0;
  for (const ev of events) {
    if (ev.eventType === AnalyticsEventType.MARKET_FIRST_LIST) firstLists++;
    if (ev.eventType === AnalyticsEventType.MARKET_FIRST_BUY) firstBuys++;
    if (ev.eventType === AnalyticsEventType.MARKET_SALE) sales++;
  }
  console.log(`  First-time listers: ${firstLists}`);
  console.log(`  First-time buyers:  ${firstBuys}`);
  console.log(`  Total sales:        ${sales}`);
  console.log();

  // ── Trades ──────────────────────────────────────────────────────────────

  console.log("─── Player Trades ────────────────────────────────────────");
  let totalTrades = 0;
  let totalTradeItems = 0;
  let totalTradeMesos = 0;
  for (const ev of events) {
    if (ev.eventType === AnalyticsEventType.TRADE_COMPLETE) {
      totalTrades++;
      totalTradeItems += (ev.payload.itemCountA as number) + (ev.payload.itemCountB as number);
      totalTradeMesos += (ev.payload.mesosA as number) + (ev.payload.mesosB as number);
    }
  }
  // Divide by 2 because each trade emits an event per player.
  const uniqueTrades = Math.floor(totalTrades / 2);
  console.log(`  Completed trades:   ${uniqueTrades}`);
  console.log(`  Items traded:       ${Math.floor(totalTradeItems / 2)}`);
  console.log(`  Mesos exchanged:    ${Math.floor(totalTradeMesos / 2)}`);
  console.log();

  // ── Deaths ─────────────────────────────────────────────────────────────

  console.log("─── Deaths ────────────────────────────────────────────────");
  let totalDeaths = 0;
  const deathByMap = new Map<string, number>();
  for (const ev of events) {
    if (ev.eventType === AnalyticsEventType.DEATH) {
      totalDeaths++;
      const map = ev.payload.mapId as string;
      deathByMap.set(map, (deathByMap.get(map) ?? 0) + 1);
    }
  }
  console.log(`  Total deaths: ${totalDeaths}`);
  const sortedDeath = [...deathByMap.entries()].sort((a, b) => b[1] - a[1]);
  for (const [map, count] of sortedDeath.slice(0, 10)) {
    console.log(`    ${map}: ${count}`);
  }
  console.log();

  // ── JSON output ────────────────────────────────────────────────────────

  const report = {
    generatedAt: new Date().toISOString(),
    totalEvents: events.length,
    totalAccounts,
    funnel: {
      created: created.size,
      lv10: lv10.size,
      firstJob: firstJob.size,
      lv30: lv30.size,
      secondJob: secondJob.size,
      dropoff: {
        beforeLv10: dropoff10,
        lv10ToJob1: dropoffJob1,
        job1ToLv30: dropoff30,
        lv30ToJob2: dropoffJob2,
      },
    },
    tutorial: {
      started: tutorialStarted.size,
      complete: tutorialComplete.size,
      droppedDuring: tutorialStarted.size - tutorialComplete.size,
    },
    retention: {
      d1: { eligible: d1Eligible, returned: d1Return },
      d3: { eligible: d3Eligible, returned: d3Return },
      d7: { eligible: d7Eligible, returned: d7Return },
    },
    classDistribution: Object.fromEntries(sorted),
    disconnectsByMap: Object.fromEntries(sortedDiscon),
    bossKills: Object.fromEntries(sortedBoss),
    partyQuests: { success: pqSuccess, fail: pqFail },
    market: { firstLists, firstBuys, sales },
    trades: {
      uniqueTrades,
      itemsTraded: Math.floor(totalTradeItems / 2),
      mesosExchanged: Math.floor(totalTradeMesos / 2),
    },
    deaths: { total: totalDeaths, byMap: Object.fromEntries(sortedDeath) },
  };

  // Write JSON to stdout with a marker so tooling can parse it.
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  JSON Report (copy from below)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(JSON.stringify(report, null, 2));
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h${m}m`;
}

main();
