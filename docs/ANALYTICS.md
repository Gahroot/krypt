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
| `market_first_list` | First-ever item listing by a character | `itemDefId`, `price` |
| `market_sale` | Item purchased (emitted for buyer + seller) | `itemDefId`, `price`, `isSeller` |
| `boss_kill` | Boss mob killed | `mobId`, `name`, `level` |
| `party_quest_run` | PQ completed (success or fail) | `pqId`, `success`, `playerCount` |
| `death` | Player HP hits 0 | `mapId`, `level` |
| `disconnect_by_map` | Player leaves a room | `mapId`, `level` |

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

**Outputs:**
1. **Onboarding funnel**: created → Lv10 → 1st job → Lv30 → 2nd job (with drop-off breakdown)
2. **D1 retention**: % of accounts that returned the next day
3. **Time-to-level**: median + p95 for Lv 10, 30, 50
4. **Class distribution**: 1st-job archetype popularity
5. **Disconnect heatmap**: per-map disconnect counts
6. **Boss kills + PQ stats**: kill counts, success/fail ratios
7. **Market activity**: first-time listers, total sales
8. **Death stats**: total deaths, per-map breakdown

All output is printed to console + a JSON summary at the bottom.

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
