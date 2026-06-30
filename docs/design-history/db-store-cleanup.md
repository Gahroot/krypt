# DB Store Cleanup Plan

## Summary

The SQLite persistence layer is **already fully implemented** — `db.ts`, `store.ts`, `importFileData.ts`, 10 migration files, and both tests (`dbMigration.ts`, `dbStore.ts`) already exist. However, two bugs need fixing:

1. **Migration test is stale** — expects 9 migrations but 10 exist (010_friends.sql was added without updating the test)
2. **File importer is missing newer columns** — `importFileData.ts` doesn't serialize columns added in migrations 002–006 (jobTier, branchId, codex, fame, achievements, totalMesosEarned, totalQuestsCompleted, totalItemsCollected, quickslots, settings, autoPot, macros)

Everything else (store, schema, README docs, .env.example, round-trip test) is correct and complete.

## Bugs

### Bug 1: `test/dbMigration.ts` — stale migration count

The test asserts `versions.length === 9` but 10 migration files exist (001–010). It also:
- Missing assertion for version 10
- Missing table checks for `analytics_events`, `feedback_reports`, `friends`
- Console log says "001–009" instead of "001–010"
- Re-open idempotency check says 9, should say 10

### Bug 2: `src/persistence/importFileData.ts` — missing newer columns

`CHAR_COL_MAP` only has columns from `001_schema.sql`. Missing:
- `jobTier` → `job_tier` (migration 003)
- `branchId` → `branch_id` (migration 003)
- `codex` → `codex` (migration 002)
- `fame` → `fame` (migration 002)
- `achievements` → `achievements` (migration 002)
- `totalMesosEarned` → `total_mesos_earned` (migration 002)
- `totalQuestsCompleted` → `total_quests_completed` (migration 002)
- `totalItemsCollected` → `total_items_collected` (migration 002)
- `quickslots` → `quickslots` (migration 004)
- `settings` → `settings` (migration 005)
- `autoPot` → `auto_pot` (migration 006)
- `macros` → `macros` (migration 006)

`JSON_KEYS` also needs the JSON-blob columns added.

## Steps

1. Fix `packages/server/test/dbMigration.ts`:
   - Change `versions.length === 9` → `10` (first phase)
   - Add assertion for `versions[9]!.version === 10`
   - Update console log to "001–010"
   - Add `analytics_events`, `feedback_reports`, `friends` to `expected` tables array
   - Update second phase idempotency check: `versions2.length === 9` → `10`, add version[9] assertion

2. Fix `packages/server/src/persistence/importFileData.ts`:
   - Add all 12 missing column mappings to `CHAR_COL_MAP`
   - Add all JSON-blob columns to `JSON_KEYS` set (codex, fame, achievements, quickslots, settings, autoPot, macros)

3. Run both tests to verify:
   - `npx tsx packages/server/test/dbMigration.ts`
   - `npx tsx packages/server/test/dbStore.ts`

## Verification

- `dbMigration.ts` passes (10 migrations, all tables present including analytics_events/feedback_reports/friends, idempotent re-open)
- `dbStore.ts` passes (full character round-trip, market, treasury, delete)
- `pnpm typecheck` passes on server package
