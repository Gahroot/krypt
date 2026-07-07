# Analytics System

Server-side analytics for measuring alpha success. Privacy-safe: no PII is ever stored — accountIds are SHA-256 hashed before persistence.

## Event Catalog

| Event | Trigger | Key Payload Fields |
|-------|---------|-------------------|
| `account_created` | New account shell via `getOrCreate()` | `createdAt` |
| `character_created` | First character auto-created on join | `class`, `name` |
| `session_start` | Player joins any room | `roomType`, `mapId` |
| `session_end` | Player leaves any room | `roomType`, `mapId`, `durationMs`, `level` |
| `level_up` | EXP grant crosses level threshold | `level`, `levelsGained`, `class` |
| `job_advance` | 1st or 2nd job advancement | `jobTier`, `class`, `branchId?`, `level` |
| `quest_accept` | Player accepts a quest | `questId`, `level` |
| `quest_complete` | Quest turned in, rewards granted | `questId`, `exp`, `mesos`, `level` |
| `tutorial_step` | Dawn Isle tutorial quest completed | `questId`, `stepIndex`, `totalSteps`, `level`, `completed` |
| `market_first_list` | First-ever item listing by a character | `itemDefId`, `price` |
| `market_first_buy` | First-ever market purchase by a character | `itemDefId`, `price` |
| `market_sale` | Item purchased (emitted for buyer + seller) | `itemDefId`, `price`, `isSeller` |
| `boss_kill` | Boss mob killed | `mobId`, `name`, `level` |
| `party_quest_run` | PQ completed (success or fail) | `pqId`, `success`, `playerCount` |
| `death` | Player HP hits 0 | `mapId`, `level` |
| `disconnect_by_map` | Player leaves a room | `mapId`, `level` |
| `trade_complete` | Player-to-player trade completed | `itemCountA`, `itemCountB`, `mesosA`, `mesosB`, `level` |

### Alpha funnel events (what to watch)

These are the critical events for answering "where do players drop off?"

1. **`account_created`** → account exists (baseline = 100%)
2. **`tutorial_step`** → Dawn Isle tutorial progress (step 0–6, final step = tutorial complete)
3. **`level_up`** → level milestones (Lv 10, 30, 50)
4. **`job_advance`** → 1st-job (tier 1) and 2nd-job (tier 2)
5. **`market_first_list`** / **`market_first_buy`** → economy engagement
6. **`trade_complete`** → social/economy engagement
7. **`disconnect_by_map`** → where players quit (correlate with level for churn stage)

## Storage

Events are appended to the `analytics_events` SQLite table (migration `008_analytics.sql`) using the same WAL-mode database the game server uses. Safe to query while the server is running.

**Schema:**
```sql
analytics_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT    NOT NULL,
  account_id  TEXT    NOT NULL,  -- SHA-256 hex digest
  char_id     TEXT,              -- nullable for account-level events
  payload     TEXT    NOT NULL,  -- JSON blob
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
)
```

## Usage in Room Code

```typescript
import { track } from "../analytics";
import { AnalyticsEventType } from "../analyticsEvents";

// In any room method:
track(AnalyticsEventType.LEVEL_UP, accountId, charId, {
  level: 15,
  levelsGained: 1,
  class: "WARRIOR",
});
```

The `track()` helper hashes the raw accountId automatically. Events are fire-and-forget — errors are logged but never crash the game loop.

## Aggregation Script

Computes alpha-success metrics from the event log:

```bash
pnpm --filter @maple/server tsx src/analyticsAggregate.ts
```

**Outputs (in order):**

1. **Onboarding funnel**: created → Lv10 → 1st job → Lv30 → 2nd job (with drop-off breakdown)
2. **Tutorial funnel**: accounts that started vs completed the Dawn Isle tutorial chain
3. **Retention**: D1, D3, D7 return rates (% of accounts whose first and last session are ≥N days apart)
4. **Time-to-level**: median + p95 for Lv 10, 30, 50
5. **Class distribution**: 1st-job archetype popularity
6. **Churn**: disconnects grouped by map + player level (answers "where do players quit?")
7. **Disconnect heatmap**: per-map disconnect counts (top 15)
8. **Boss kills + PQ stats**: kill counts, success/fail ratios
9. **Market activity**: first-time listers, first-time buyers, total sales
10. **Player trades**: completed trades, items exchanged, mesos exchanged
11. **Death stats**: total deaths, per-map breakdown

All output is printed to console + a JSON summary at the bottom.

## Reading the Report

### "Where do new players drop off?"

Look at two sections:

1. **Onboarding Funnel** — shows the progression from account creation through job advancement. The "Drop-off breakdown" line tells you exactly how many players (and what %) quit at each stage:
   - "Before Lv 10" = players who never made it past the early grind
   - "Lv 10 → 1st job" = players who reached Lv 10 but didn't advance
   - "1st job → Lv 30" = mid-game churn
   - "Lv 30 → 2nd job" = late-game churn

2. **Tutorial Funnel** — shows how many players completed the Dawn Isle tutorial. If many players drop *during* the tutorial, the opening experience needs work.

3. **Churn (Disconnects by Map + Level)** — shows the top disconnect locations with the player's level. High disconnects at low levels = early churn. High disconnects on a specific map = difficulty/frustration spike.

### "What % reach Lv 10 / 2nd job?"

Read directly from the Onboarding Funnel:
- `Reached Lv 10: X (Y%)` — Y% of created accounts
- `2nd job advance: X (Y%)` — Y% of created accounts

### Retention

- **D1**: % of accounts whose first and last session are ≥1 day apart (came back next day)
- **D3**: % with ≥3 day span
- **D7**: % with ≥7 day span

These are simplified metrics. For alpha, D1 retention is the most important — if players don't come back the next day, the core loop isn't sticky.

## Privacy

- **AccountIds** are SHA-256 hashed before storage — irreversible.
- **Character names** are stored in `character_created` events only (needed for debugging; not linked to account hash in a reversible way).
- **No IP addresses, email, or real-world PII** is ever written.
- The raw `accountId` never touches the analytics table.

## Architecture Decisions

1. **Append-only**: No UPDATE/DELETE on analytics rows. Simple, auditable, fast.
2. **Same DB**: Reuses the game's SQLite database — no new infrastructure. The WAL mode allows concurrent reads while the server writes.
3. **Fire-and-forget**: Analytics failures never affect gameplay. The `try/catch` in the store logs errors silently.
4. **In-room tracking**: Events are emitted at the point of action (in the room that performed it), not via a central dispatcher. This keeps coupling low and ensures we capture context (mapId, level) accurately.
