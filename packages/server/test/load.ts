/**
 * load.ts — headless CCU load harness for a single MapRoom.
 *
 * Spawns N bot clients into ONE MapRoom, each driving realistic INPUT + attack
 * traffic at ~60 Hz, and measures the authoritative simulation's cost as N grows:
 *
 *   • per-tick `fixedTick` duration vs the 1000/60 (16.67 ms) budget
 *   • ticks that overrun the budget (spiral-of-death / lag risk)
 *   • observed tick-rate (Hz) — falls below 60 when the loop can't keep up
 *   • Node process CPU utilization over the steady-state window
 *   • server→client STATE-PATCH size (bytes/patch/client) + bandwidth
 *   • per-tick broadcast-message bandwidth (surfaces e.g. boss_hp spam)
 *
 * ## How it isolates the simulation
 *
 * The in-process `@colyseus/testing` server boots a real Colyseus server; bots are
 * real SDK clients over an in-memory transport. We grab the *server-side* room via
 * `getRoomById` and wrap `room.fixedTick` (per-tick wall-clock) and every
 * `client.raw` (the single wire-send path). `fixedTick` is pure simulation cost —
 * input parsing happens in the message handler, NOT in the tick — so its duration is
 * the authoritative "does this room fit in its budget?" signal.
 *
 * Each `client.raw` buffer's first byte is the Colyseus protocol opcode, so we split
 * bandwidth cleanly: `15` = state patch (the diff), `13` = broadcast message
 * (e.g. boss_hp), `14` = full state (join only — excluded by the warmup gate).
 *
 * ## Reproduce
 *
 *   pnpm --filter @maple/server run load
 *   pnpm --filter @maple/server run load -- --sizes 10,25,50,100 --duration 10000
 *
 * Flags: --sizes  --map  --warmup  --duration  --inputHz  --out  --maxclients
 */
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { bootAuthed } from "./authBoot.js";
import appConfig from "../src/app.config.js";
import { MessageType } from "../src/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Colyseus wire opcodes (first byte of each client.raw buffer).
const OP_ROOM_DATA = 13; // broadcast JSON message (boss_hp, combat hit, …)
const OP_ROOM_STATE_PATCH = 15; // state diff patch (broadcastPatch). (Opcode 14 = full state on join — excluded by the warmup gate.)

// ─── CLI ───────────────────────────────────────────────────────────────────
function parseArgs(): {
  sizes: number[];
  map: string;
  warmupMs: number;
  durationMs: number;
  inputHz: number;
  outPath: string;
  maxClientsOverride: number;
} {
  const a = process.argv.slice(2);
  const get = (k: string, dflt: string): string => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 && a[i + 1] ? a[i + 1] : dflt;
  };
  return {
    sizes: get("sizes", "10,25,50,100")
      .split(",")
      .map((n) => Number(n.trim()))
      .filter(Boolean),
    map: get("map", "meadowfield"),
    warmupMs: Number(get("warmup", "3000")),
    durationMs: Number(get("duration", "10000")),
    inputHz: Number(get("inputHz", "60")),
    outPath: get("out", "test/load-results.json"),
    maxClientsOverride: Number(get("maxclients", "256")),
  };
}

// ─── Stats ─────────────────────────────────────────────────────────────────
interface TickStats {
  count: number;
  totalMs: number;
  max: number;
  overBudget: number;
  samples: number[];
}

function freshTicks(): TickStats {
  return { count: 0, totalMs: 0, max: 0, overBudget: 0, samples: [] };
}

function recordTick(s: TickStats, ms: number, budgetMs: number): void {
  s.count++;
  s.totalMs += ms;
  if (ms > s.max) s.max = ms;
  if (ms > budgetMs) s.overBudget++;
  if (s.samples.length < 200_000) s.samples.push(ms);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  return sortedAsc[
    Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1))
  ];
}

interface Probe {
  measuring: boolean;
  budgetMs: number;
  ticks: TickStats;
  patchCalls: number; // op 15 sends (one per client per broadcastPatch with changes)
  patchBytes: number;
  msgCalls: number; // op 13 broadcast-message sends
  msgBytes: number;
}

function freshProbe(budgetMs: number): Probe {
  return {
    measuring: false,
    budgetMs,
    ticks: freshTicks(),
    patchCalls: 0,
    patchBytes: 0,
    msgCalls: 0,
    msgBytes: 0,
  };
}

type ServerRoom = {
  fixedTick: (ts: number) => void;
  clients: Array<{
    raw: (data: Uint8Array | Buffer) => void;
    __lt?: boolean;
  }> & { forEach: (cb: (c: unknown) => void) => void };
  state: { players: { size: number }; mobs: { size: number } };
};

/**
 * Instrument a server-side MapRoom instance (test-only): wrap `fixedTick` to time
 * each tick, and wrap every client's `raw` (the sole wire-send path) to tally
 * bandwidth split by opcode. Counters are gated on `probe.measuring` so join-time
 * full states (opcode 14) are excluded.
 */
function instrumentRoom(room: unknown, probe: Probe): void {
  const r = room as ServerRoom;

  const origFixed = r.fixedTick.bind(r);
  r.fixedTick = (ts: number) => {
    const t0 = performance.now();
    origFixed(ts);
    const dt = performance.now() - t0;
    if (probe.measuring) recordTick(probe.ticks, dt, probe.budgetMs);
  };

  // Wrap every connected client's wire sender exactly once (re-run a couple times so
  // clients still finishing their async join during warmup are covered).
  const wrapClients = () => {
    r.clients.forEach((c) => {
      const client = c as { raw: (data: Uint8Array | Buffer) => void; __lt?: boolean };
      if (client.__lt) return;
      client.__lt = true;
      const origRaw = client.raw.bind(client);
      client.raw = (data: Uint8Array | Buffer) => {
        if (probe.measuring) {
          const op = data[0];
          const len = data.length;
          if (op === OP_ROOM_STATE_PATCH) {
            probe.patchCalls++;
            probe.patchBytes += len;
          } else if (op === OP_ROOM_DATA) {
            probe.msgCalls++;
            probe.msgBytes += len;
          }
        }
        return origRaw(data);
      };
    });
  };
  setTimeout(wrapClients, 200);
  setTimeout(wrapClients, 1500);
}

// ─── Bot driver ────────────────────────────────────────────────────────────
interface BotRoom {
  sessionId: string;
  roomId: string;
  send: (type: number, data: unknown) => void;
  onMessage: (type: string | number, cb: () => void) => void;
  leave: () => Promise<void>;
}

/**
 * Drive every bot with realistic grinding traffic: hold attack, wander left/right,
 * occasional jump. One master timer (not N timers) batches arrival — a realistic
 * worst case and far cheaper to schedule. Each send is well under the 120/s input
 * rate-limiter.
 */
function startDriver(bots: BotRoom[], inputHz: number): () => void {
  const intervalMs = Math.max(8, Math.round(1000 / inputHz));
  let tickN = 0;
  const timer = setInterval(() => {
    tickN++;
    const t = tickN;
    for (let i = 0; i < bots.length; i++) {
      const goLeft = (((t >> 6) + i) & 1) === 0; // flip ~every 1s, staggered
      bots[i].send(MessageType.INPUT, {
        left: goLeft,
        right: !goLeft,
        up: false,
        down: false,
        attack: true,
        jump: (t + i) % 41 === 0,
        interact: false,
        tick: t,
      });
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

// ─── Single-N run ──────────────────────────────────────────────────────────
interface RunResult {
  N: number;
  players: number;
  mobs: number;
  tickCount: number;
  tickMeanMs: number;
  tickP50Ms: number;
  tickP95Ms: number;
  tickP99Ms: number;
  tickMaxMs: number;
  budgetMs: number;
  budgetUtilPct: number;
  ticksOverBudget: number;
  observedHz: number;
  patchBytesPerClient: number; // bytes/patch/client (opcode-15 average)
  patchKbpsAll: number; // server→all, state patch
  bcastPerSecPerClient: number; // broadcast messages/s/client (boss_hp etc.)
  bcastKbpsAll: number; // server→all, broadcasts
  cpuPct: number;
  overrun: boolean;
}

async function runSize(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
  opts: {
    N: number;
    map: string;
    warmupMs: number;
    durationMs: number;
    inputHz: number;
    maxClientsOverride: number;
  },
): Promise<RunResult> {
  const { N, map, warmupMs, durationMs, inputHz, maxClientsOverride } = opts;
  const budgetMs = 1000 / 60;
  const probe = freshProbe(budgetMs);

  // Create ONE room (1 client, not yet locked), then RAISE maxClients ON THE
  // INSTANCE before packing the remaining bots. `maxClients` is a class field, so it
  // is set on each instance in the constructor — mutating the prototype is a no-op.
  // This is the only way to push past the real per-room cap to find the break point.
  const sdk = colyseus.sdk as unknown as {
    create: (name: string, options?: Record<string, unknown>) => Promise<BotRoom>;
    joinById: (roomId: string, options?: Record<string, unknown>) => Promise<BotRoom>;
  };
  const first = await sdk.create(map, { name: `load_${N}_0` });
  const roomId = first.roomId;

  const serverRoom = colyseus.getRoomById(roomId) as ServerRoom & {
    maxClients: number;
    unlock: () => Promise<void>;
  };
  serverRoom.maxClients = Math.max(maxClientsOverride, N + 4);
  await serverRoom.unlock();
  instrumentRoom(serverRoom, probe);

  const bots: BotRoom[] = [first];
  // Register handlers for the frequent server broadcasts so the SDK doesn't log a
  // warning per tick (keeps the run clean + avoids console-spam CPU) on every bot.
  const quiet = (r: BotRoom) => {
    r.onMessage("boss_hp", () => {});
    r.onMessage(MessageType.COMBAT_HIT, () => {});
    r.onMessage("mob_hit_player", () => {});
  };
  quiet(first);
  for (let i = 1; i < N; i++) {
    const r = await sdk.joinById(roomId, { name: `load_${N}_${i}` });
    quiet(r);
    bots.push(r);
  }

  await sleep(warmupMs); // joins + initial full states settle

  const players = serverRoom.state.players.size;
  const mobs = serverRoom.state.mobs.size;

  // ── Steady-state measurement window ──────────────────────────────────────
  const stopDriver = startDriver(bots, inputHz);
  const cpuBefore = process.cpuUsage();
  const wallBefore = performance.now();

  probe.measuring = true;
  await sleep(durationMs);
  probe.measuring = false;

  const wallAfter = performance.now();
  const cpuAfter = process.cpuUsage(cpuBefore);
  stopDriver();

  const wallSec = (wallAfter - wallBefore) / 1000;
  const cpuMs = (cpuAfter.user + cpuAfter.system) / 1000;
  const cpuPct = (cpuMs / (wallSec * 1000)) * 100;

  const samples = probe.ticks.samples.slice().sort((a, b) => a - b);
  const tickMean = probe.ticks.count ? probe.ticks.totalMs / probe.ticks.count : 0;
  const observedHz = probe.ticks.count / wallSec;
  const clients = Math.max(1, N);

  const overrun = probe.ticks.overBudget > 0 || observedHz < 55;

  return {
    N,
    players,
    mobs,
    tickCount: probe.ticks.count,
    tickMeanMs: round(tickMean, 2),
    tickP50Ms: round(percentile(samples, 50), 2),
    tickP95Ms: round(percentile(samples, 95), 2),
    tickP99Ms: round(percentile(samples, 99), 2),
    tickMaxMs: round(probe.ticks.max, 2),
    budgetMs: round(budgetMs, 2),
    budgetUtilPct: round((tickMean / budgetMs) * 100, 1),
    ticksOverBudget: probe.ticks.overBudget,
    observedHz: round(observedHz, 1),
    patchBytesPerClient: probe.patchCalls ? round(probe.patchBytes / probe.patchCalls, 1) : 0,
    patchKbpsAll: round((probe.patchBytes * 8) / 1000 / wallSec, 1),
    bcastPerSecPerClient: round(probe.msgCalls / clients / wallSec, 1),
    bcastKbpsAll: round((probe.msgBytes * 8) / 1000 / wallSec, 1),
    cpuPct: round(cpuPct, 1),
    overrun,
  };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ─── Reporting ─────────────────────────────────────────────────────────────
function fmtRow(r: RunResult): string {
  const flag = r.overrun ? " ⚠ OVERRUN" : " ✓";
  return (
    `N=${String(r.N).padStart(3)} pl=${String(r.players).padStart(3)} ` +
    `tick=${r.tickMeanMs}/${r.tickP95Ms}/${r.tickP99Ms}/${r.tickMaxMs}ms ` +
    `(mean/p95/p99/max, budget ${r.budgetMs} util ${r.budgetUtilPct}%) ` +
    `over=${r.ticksOverBudget} hz=${r.observedHz} ` +
    `| patch ${fmtBytes(r.patchBytesPerClient)}/cl ${r.patchKbpsAll}kbps-all ` +
    `bcast ${r.bcastPerSecPerClient}/s/cl ${r.bcastKbpsAll}kbps-all ` +
    `| cpu ${r.cpuPct}%${flag}`
  );
}

function fmtBytes(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${Math.round(n)}B`;
}

function recommend(results: RunResult[]): { safeCap: number; cleanN: number; reason: string } {
  // The safe per-room cap is the largest N that holds the tick budget with
  // comfortable headroom: no overruns, max tick under budget, p95 < 70% of budget,
  // and the loop still tracking ~60 Hz. Pick the highest clean N, then derate ~25%
  // for real-world variance (GC pauses, slower hosts, the single event-loop thread).
  let cleanN = 0;
  for (const r of results) {
    const headroomOk = r.tickP95Ms <= r.budgetMs * 0.7 && r.tickMaxMs <= r.budgetMs;
    if (!r.overrun && headroomOk) cleanN = Math.max(cleanN, r.N);
  }
  if (cleanN === 0) cleanN = results[0]?.N ?? 10; // every size overran — report smallest
  const derated = Math.max(4, Math.floor((cleanN * 3) / 4)); // 0.75×, min 4
  const c = results.find((r) => r.N === cleanN);
  return {
    safeCap: derated,
    cleanN,
    reason:
      `Highest N with no tick overruns and p95 < 70% of the ${c?.budgetMs}ms budget was ` +
      `${cleanN} (p95=${c?.tickP95Ms}ms, max=${c?.tickMaxMs}ms, ${c?.observedHz}Hz). ` +
      `Derated ~25% → ${derated} per room for real-world variance (GC, slower hosts, the single-threaded event loop).`,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────
const watchdog = setTimeout(() => {
  console.error("[load] FAIL ✘ watchdog timeout (test hung)");
  process.exit(1);
}, 1_200_000);

async function main(): Promise<void> {
  const opts = parseArgs();

  // NOTE: the per-room cap is raised on each room *instance* inside runSize
  // (mutating the prototype is a no-op because `maxClients` is a class field). The
  // real production cap is set afterwards in MapRoom, from these findings.

  // Disable the periodic all-players autosave so its SQLite flush doesn't pollute
  // per-tick sim timings; event-driven persists (on kills) still happen and are part
  // of real combat cost. Read at module load — set before boot.
  process.env.MAPLE_AUTOSAVE_INTERVAL_MS ??= "600000";

  console.log(
    `[load] map=${opts.map} sizes=[${opts.sizes.join(",")}] ` +
      `warmup=${opts.warmupMs}ms duration=${opts.durationMs}ms inputHz=${opts.inputHz} ` +
      `(maxClients temporarily raised to ${opts.maxClientsOverride}; autosave disabled for the run)`,
  );

  const colyseus = await bootAuthed(appConfig);
  const results: RunResult[] = [];

  try {
    for (const N of opts.sizes) {
      console.log(`\n[load] ── N=${N} ──`);
      const r = await runSize(colyseus, {
        N,
        map: opts.map,
        warmupMs: opts.warmupMs,
        durationMs: opts.durationMs,
        inputHz: opts.inputHz,
        maxClientsOverride: opts.maxClientsOverride,
      });
      console.log(fmtRow(r));
      results.push(r);
    }
  } finally {
    await colyseus.shutdown();
  }

  const rec = recommend(results);
  console.log("\n[load] ═══ summary ═══");
  for (const r of results) console.log("  " + fmtRow(r));
  console.log(`\n[load] recommended maxClients ≈ ${rec.safeCap}  (clean up to N=${rec.cleanN})`);
  console.log(`[load] ${rec.reason}`);

  writeFileSync(opts.outPath, JSON.stringify({ opts, results, recommendation: rec }, null, 2));
  console.log(`[load] wrote ${opts.outPath}`);

  clearTimeout(watchdog);
  process.exit(0);
}

main().catch((err) => {
  console.error("[load] FAIL ✘", err);
  process.exit(1);
});
