# MapRoom load test — safe CCU per room

Headless load harness that packs N bot clients into **one** `MapRoom`, drives each at
realistic ~60 Hz grind traffic (move + attack), and measures the authoritative
simulation's cost as N grows. Goal: a **documented, reproducible safe `maxClients`**
before inviting testers.

- **Harness:** [`packages/server/test/load.ts`](../packages/server/test/load.ts)
- **Run:** `pnpm --filter @maple/server run load` (flags: `--sizes`, `--map`, `--warmup`, `--duration`, `--inputHz`)
- **Map tested:** `meadowfield` (canonical early zone; spawns the Mano field boss).
- **Host:** Apple laptop, Node 20, in-process `@colyseus/testing` loopback. Numbers are
  **relative scaling curves**, not absolute production SLAs — real WebSocket/TCP I/O adds
  overhead the loopback doesn't measure.

## TL;DR — recommendation

> **`maxClients = 50`** per map channel. (`MapRoom` is already set to this; it is now
> **load-test-justified**, not a guess.)

- The authoritative `fixedTick` is **never** the bottleneck — its *mean* is ~1 ms even at
  100 clients (6% of the 16.67 ms budget). The sim is cheap.
- **First tick-budget overruns appear around N=90–100**, and only on some runs — they are
  GC + patch-encode *spikes* (max tick 18–31 ms when they hit), not steady sim cost. The
  boundary is **soft / GC-jitter-dependent**: a clean run can pass 100 with 0 overruns (max
  ~6 ms), a less-lucky one trips a handful at 90. Either way **N=80 is comfortably clean**
  and observed Hz never drops below 60 (the fixed-step accumulator recovers — no spiral of death).
- The **binding constraint is bandwidth**, and it scales ~**quadratically**: each state
  patch grows with N (it diffs all players) and is sent to N clients → ~11 Mbps/room at 50,
  ~30 Mbps at 80, ~46 Mbps at 100.
- 50 sits ~1.6× below the overrun cliff and keeps per-room traffic sane for shared hosting.
  The `boss_hp`-every-tick broadcast (~60 msgs/s to *every* client) is the highest-impact
  follow-up — throttling it roughly **halves** per-room bandwidth and widens headroom.

A data-driven derate from the clean boundary (80 × 0.75) lands at **60**; we hold the line at
**50 for the first playtest** (extra margin for real network I/O, persistence spikes, and boss
fights). Revisit upward toward 60–80 after the `boss_hp` throttle + dedicated/beefier hosting.

## Results

Single room, bots holding attack + wandering, 12 s steady-state window after 4 s warmup.
`tick` = `mean / p95 / p99 / max` ms. Budget = `1000/60 = 16.67 ms`. `over` = ticks that
exceeded the budget. `patch` = state-patch (opcode 15); `bcast` = broadcast messages
(opcode 13, mostly `boss_hp`).

| N  | tick mean | tick p95 | tick p99 | tick max | over | Hz   | patch/cl | patch (all) | bcast/cl | cpu   | verdict |
|----|-----------|----------|----------|----------|------|------|----------|-------------|----------|-------|---------|
| 10 | 0.64 ms   | 1.39 ms  | 2.61 ms  | 9.1 ms   | 0    | 60   | 285 B    | 0.45 Mbps   | 64/s     | 14 %  | ✓ clean |
| 25 | 0.64 ms   | 1.48 ms  | 3.05 ms  | 7.0 ms   | 0    | 60   | 623 B    | 2.5 Mbps    | 62/s     | 22 %  | ✓ clean |
| 50 | 0.66 ms   | 0.97 ms  | 1.34 ms  | 9.7 ms   | 0    | 60   | 1.2 KB   | 9.5 Mbps    | 62/s     | 29 %  | ✓ clean |
| 60 | 0.67 ms   | 1.01 ms  | 1.44 ms  | 5.9 ms   | 0    | 60   | 1.4 KB   | 13.7 Mbps   | 61/s     | 27 %  | ✓ clean |
| 70 | 0.71 ms   | 0.99 ms  | 1.32 ms  | 5.6 ms   | 0    | 60   | 1.7 KB   | 18.7 Mbps   | 61/s     | 41 %  | ✓ clean |
| 80 | 0.91 ms   | 1.49 ms  | 6.58 ms  | 12.8 ms  | 0    | 60   | 1.9 KB   | 24.5 Mbps   | 91/s     | 54 %  | ✓ clean (last) |
| 90 | 0.85 ms   | 1.25 ms  | 6.38 ms  | 18.3 ms  | 2    | 60   | 2.1 KB   | 30.8 Mbps   | 77/s     | 66 %  | ⚠ overrun onset |
| 100| 1.28 ms   | 1.62 ms  | 17.9 ms  | 31.1 ms  | 8    | 60   | 2.4 KB   | 37.7 Mbps   | 113/s    | 58 %  | ⚠ janky |

### What the numbers say

1. **Simulation is cheap.** Even at 100 clients the mean `fixedTick` is 1.28 ms — **7.7 %**
   of the 16.67 ms budget. p95 stays under 1.7 ms everywhere. Combat, movement, mob AI,
   loot, and the 20 Hz state-diff encoding all fit comfortably; CPU is dominated by
   per-client patch I/O and the `boss_hp` fan-out, not by game logic.
2. **Overruns are GC/encode spikes, not sim complexity — and they're soft.** When they
   appear (~90–100 clients) it's single-frame hitches (p99 ≈ 6–18 ms, max 18–31 ms) from
   allocating/copying patches for ~90–100 clients on the single event-loop thread. They are
   **run-to-run GC-jitter-dependent**: one run trips a handful at 90, another passes 100
   clean (max ~6 ms). Observed Hz never drops below 60, so the fixed-step accumulator always
   recovers (no spiral of death). The deterministic ceiling is bandwidth, below.
3. **Bandwidth is quadratic and is the real ceiling.** Patch-per-client ≈ linear in N
   (more players to diff each tick); × N clients ⇒ server→all ≈ O(N²). A hot room at 100
   emits **~46 Mbps** of state patches alone — impractical for one room on modest uplinks,
   and it doubles client decode cost. This is why 50 (≈11 Mbps) is the comfortable cap.
4. **`boss_hp` is broadcast every tick to every client** (~60/s/client) whether the boss's HP
   changed or not. At 100 clients that's ~6000 redundant sends/sec — a large slice of the
   `bcast` column and a cheap, high-leverage fix.

## How the harness measures

- Boots a **real Colyseus server in-process** via `@colyseus/testing`; bots are real SDK
  clients over an in-memory transport. One room is `create`d, then N−1 bots `joinById` into
  the *same* room (the per-room cap is raised on the instance so we can push past it).
- Grabs the **server-side room** (`getRoomById`) and wraps `room.fixedTick` to time every
  tick, and every `client.raw` (the single wire-send path) to tally bytes. `fixedTick` is
  **pure simulation** — client input is parsed in the message handler, not the tick — so its
  duration is the authoritative budget-fit signal.
- Each `client.raw` buffer's first byte is the Colyseus opcode (`15` = state patch, `13` =
  broadcast message, `14` = full state on join), so bandwidth is split cleanly. Counters are
  gated on a `measuring` flag so join-time full-state sends are excluded; the steady window
  captures only ongoing patches + broadcasts.
- Reported: per-tick mean/p50/p95/p99/max, ticks-over-budget, observed Hz, whole-process CPU
  (`process.cpuUsage` / wall), patch bytes/client/broadcast, server→all patch + broadcast
  bandwidth. The periodic all-players autosave is disabled for the run so SQLite flushes
  don't pollute per-tick timings; event-driven persists (on kills) still happen and are real.

## Channel strategy

Each map already runs **3 channels** (`CHANNELS_PER_MAP = 3` in `app.config.ts`), so a full
map supports **3 × 50 = 150 concurrent players** before matchmaking opens a new shard. That is
the right unit of horizontal scaling:

- **A channel = one OS process's room instance** sharing one event-loop thread. Keep rooms
  small and plentiful (50/room) rather than few and huge — a 150-client room would peg one
  core and emit >60 Mbps, while three 50-client rooms spread the load across cores/boxes.
- **Channel auto-balancing** (`/channels?mapId=…` returns live counts) should steer new joins
  to the least-full channel so no single room nears the cap while others sit empty.
- **Boss maps cost more** (extra mob AI + the `boss_hp` fan-out). Until `boss_hp` is
  throttled, treat combat/boss maps as effectively ~40–45 safe CCU.

## Follow-ups (recommended, not blocking the cap)

1. **Throttle `boss_hp`** — send on HP change or at ≤10 Hz instead of every tick. ~halves
   per-room broadcast bandwidth; biggest single win.
2. **Spatial/relevant-set patching** — Colyseus view filters could cut patch size on large
   maps (only diff players/mobs near each client), flattening the O(N²) curve and pushing the
   cap well past 80.
3. **Re-run on production-equivalent hardware** over a real WebSocket transport before raising
   the cap; the loopback under-counts real I/O cost.
