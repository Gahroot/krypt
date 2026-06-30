# SQLite Persistence — Replace File-Based Store

## Goal
Replace the file-based JSON persistence in `packages/server/src/persistence/store.ts` with SQLite via `better-sqlite3`, keeping the exact same exported API (`AccountStore`, `MarketStore`, `TreasuryStore`, `GuildStore`, singletons, and all types). Add a migration system, a one-time JSON importer, a round-trip test, and document the DB env config.

## Why
JSON file persistence doesn't survive concurrent writes, doesn't scale, and has no atomicity. SQLite is the natural local/dev drop-in: zero-config, single-file, WAL mode, and a clear `DATABASE_URL=postgresql://…` path for prod later.

## Design

### Database layer (`packages/server/src/persistence/db.ts`)
- Wrap `better-sqlite3` in a thin `Db` class exported as a singleton.
- The `Db` class opens the database, enables WAL mode, runs migrations on construction, and exposes the raw `better-sqlite3` `Database` instance for the store classes to prepare statements.
- `DATABASE_URL` env var: if it starts with `postgres://` or `postgresql://`, throw a clear "Postgres driver not yet installed — use SQLite for local dev" message (documented migration path). If unset or `sqlite://…`, use SQLite. The path portion becomes the SQLite file path (default `./data/maple.db`).
- Env vars:
  - `DATABASE_URL` — `sqlite://./data/maple.db` (default) or `postgresql://…` (future).
  - `DATA_DIR` — legacy, still supported as fallback for the JSON importer.

### Migration system (`packages/server/src/persistence/migrations/`)
- A `schema_migrations` table tracks applied version numbers.
- Each migration is a numbered `.sql` file: `001_accounts.sql`, `002_characters.sql`, etc.
- On `Db` construction, scan the `migrations/` dir, sort, skip already-applied, run each in a transaction.
- Migration runner lives in `db.ts` (small, ~40 lines).

### Schema (SQL)

```sql
-- 001_schema.sql  (single file for the initial schema)

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  cash INTEGER NOT NULL DEFAULT 10000,
  cash_inventory TEXT NOT NULL DEFAULT '[]',   -- JSON array of item IDs
  storage TEXT NOT NULL DEFAULT '{}'            -- JSON Record<string, ItemRecord>
);

CREATE TABLE IF NOT EXISTS characters (
  char_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id),
  name TEXT NOT NULL,
  archetype TEXT NOT NULL,
  appearance TEXT NOT NULL,                     -- JSON CharacterAppearance
  level INTEGER NOT NULL DEFAULT 1,
  exp INTEGER NOT NULL DEFAULT 0,
  ap INTEGER NOT NULL DEFAULT 0,
  sp INTEGER NOT NULL DEFAULT 0,
  stats TEXT NOT NULL DEFAULT '{}',             -- JSON {STR,DEX,INT,LUK,HP,MP}
  max_hp INTEGER NOT NULL DEFAULT 50,
  max_mp INTEGER NOT NULL DEFAULT 5,
  mesos INTEGER NOT NULL DEFAULT 0,
  map_id TEXT NOT NULL DEFAULT 'meadowfield',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  inventory TEXT NOT NULL DEFAULT '{}',         -- JSON Record<string, ItemRecord>
  equipped TEXT DEFAULT NULL,                   -- JSON Record<string, string> | null
  equipped_cash TEXT DEFAULT NULL,              -- JSON Record<string, CashEquipEntry> | null
  quests TEXT DEFAULT NULL,                     -- JSON QuestState[] | null
  learned_skills TEXT DEFAULT '[]',            -- JSON string[]
  skill_book TEXT DEFAULT '{}',                -- JSON Record<string, number>
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS listings (
  listing_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  item TEXT NOT NULL,                           -- JSON ItemRecord
  price INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS treasury (
  id INTEGER PRIMARY KEY CHECK (id = 1),       -- single row
  total_burned INTEGER NOT NULL DEFAULT 0,
  by_reason TEXT NOT NULL DEFAULT '{}'          -- JSON Record<string, number>
);

CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emblem TEXT NOT NULL,                         -- JSON {color, label}
  created_date INTEGER NOT NULL,
  roster_entries TEXT NOT NULL DEFAULT '[]'     -- JSON Array<[string, string]>
);
```

### Store classes — same API, DB backend
Each store class (`AccountStore`, `MarketStore`, `TreasuryStore`, `GuildStore`) keeps its exact public method signatures. Internally:
- **No more in-memory `Map`** — reads query the DB, writes issue SQL.
- **No more debounced JSON flush** — SQLite WAL handles durability. The `persistNow()` method becomes a no-op (or explicit `PRAGMA wal_checkpoint(PASSIVE)` for the edge case callers that want it).
- **JSON columns** for complex nested data (inventory, equipped, appearance, stats, quests, skill book, cash items, storage, guild roster). This is the pragmatic choice: the column-level data is always loaded/saved as a unit, and it lets us normalize later without changing the API.
- **Sequence counters** — `INTEGER PRIMARY KEY` autoincrement or a `sequences` table for `chr_N`, `lst_N`, `guild_N` prefixes.

Constructor signature: `new AccountStore(dataDir?: string)` → the `dataDir` param is ignored (DB path comes from `DATABASE_URL`). For tests, accept an optional `dbPath?: string` override. The existing `characters.ts` test calls `new AccountStore(TEST_DIR)` — we'll make this still work by treating the string as a SQLite file path (`${dataDir}/maple.db`).

### One-time importer (`packages/server/src/persistence/importFileData.ts`)
- CLI script: `tsx src/persistence/importFileData.ts`
- Reads `DATA_DIR/accounts.json`, `characters.json`, `listings.json`, `treasury.json`, `guilds.json`.
- Inserts into the SQLite DB. Skips if data already exists (idempotent).
- Logs counts of imported records.

### Singleton initialization
The current `store.ts` creates singletons at module scope. This pattern stays:
```ts
export const accountStore = new AccountStore();
export const marketStore = new MarketStore();
export const treasuryStore; // same pattern
export const guildStore;    // same pattern (currently only used internally, but we'll export it too)
```

### Types
All existing exported types (`Account`, `CharacterRecord`, `ItemRecord`, `ListingRecord`, `Treasury`, `STORAGE_CAPACITY`) stay in `store.ts` unchanged.

### Test (`packages/server/test/dbStore.ts`)
A tsx script test that:
1. Creates an `AccountStore` pointing at a temp SQLite file.
2. Creates a full character (all fields: stats, level, exp, AP, SP, skill book, inventory with multiple items, equipped slots, equipped cash items, quests).
3. Verifies every field round-trips correctly.
4. Tests `marketStore` add/remove.
5. Tests `treasuryStore` recordBurn/snapshot.
6. Tests guild creation via `guildManager` + persistence.
7. Cleans up the temp file.

### Migration test (`packages/server/test/dbMigration.ts`)
- Creates an empty SQLite DB.
- Instantiates the store (triggers migration).
- Verifies all tables exist.
- Verifies `schema_migrations` has the correct version.

### Dependencies
- `better-sqlite3` + `@types/better-sqlite3` added to `packages/server` `dependencies` and `devDependencies` respectively.

### `.env` / README
Add to `.env.example`:
```
# ─── Database ─────────────────────────────────────────────────────────
# SQLite (default for local dev): file path for the database
DATABASE_URL=sqlite://./data/maple.db
# Postgres (production): uncomment when the PG driver is installed
# DATABASE_URL=postgresql://user:pass@localhost:5432/maple
```

Add a "Database" section to `README.md` under Configuration explaining the `DATABASE_URL` env var.

## Files to create/modify

| File | Action |
|------|--------|
| `packages/server/package.json` | Add `better-sqlite3` dep, `@types/better-sqlite3` devDep |
| `packages/server/src/persistence/db.ts` | **NEW** — Db class, migration runner |
| `packages/server/src/persistence/migrations/001_schema.sql` | **NEW** — initial schema |
| `packages/server/src/persistence/store.ts` | **REWRITE** — same exports, DB backend |
| `packages/server/src/persistence/importFileData.ts` | **NEW** — one-time JSON→SQLite importer |
| `packages/server/test/dbStore.ts` | **NEW** — round-trip test |
| `packages/server/test/dbMigration.ts` | **NEW** — migration test |
| `packages/server/package.json` (test script) | Add new tests to the `test` script |
| `.env.example` | Add `DATABASE_URL` |
| `README.md` | Add Database section to Configuration |
| `packages/server/src/guildManager.ts` | Minor: keep `loadGuilds` / `snapshotForPersist` working (no changes needed, guildStore calls them) |

## Risks & mitigations
1. **`strictNullChecks: false` in tsconfig** — the codebase already relies on this; our code will match.
2. **`better-sqlite3` is native** — requires a build step on install. `pnpm install` handles this via `node-gyp`. On CI without build tools, the dev can fall back to the JSON importer path.
3. **All existing tests** — the API surface is identical, so existing tests pass unchanged. The `AccountStore(TEST_DIR)` constructor pattern is preserved.
4. **`persistNow()` called on shutdown/room dispose** — becomes a no-op (DB is already durable). No callers need to change.

## Steps
1. Install `better-sqlite3` + `@types/better-sqlite3` in `packages/server`.
2. Create `packages/server/src/persistence/migrations/001_schema.sql` with the full schema.
3. Create `packages/server/src/persistence/db.ts` with the `Db` class and migration runner.
4. Rewrite `packages/server/src/persistence/store.ts` to use the DB behind the same API.
5. Create `packages/server/src/persistence/importFileData.ts` (one-time JSON importer).
6. Create `packages/server/test/dbStore.ts` (round-trip save/load test for full character).
7. Create `packages/server/test/dbMigration.ts` (migration applies cleanly to empty DB).
8. Update `packages/server/package.json` test script to include the new tests.
9. Update `.env.example` with `DATABASE_URL`.
10. Update `README.md` with a Database section.
11. Run `pnpm typecheck` and `pnpm --filter @maple/server test` to verify everything passes.
