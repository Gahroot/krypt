/**
 * Migration test — proves the migration system applies cleanly to an empty database,
 * creates all expected tables, and is idempotent (re-running doesn't fail or duplicate).
 *
 * Run: npx tsx test/dbMigration.ts
 */
import assert from "node:assert";
import { rmSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

rmSync(".data_test_migration", { recursive: true, force: true });

// Derive the expected migration set from the migrations directory (the single
// source of truth) so this test never goes stale when new migrations are added.
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = resolve(__dirname, "../src/persistence/migrations");
const MIGRATION_VERSIONS = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => Number(/^(\d+)/.exec(f)?.[1] ?? "0"))
  .sort((a, b) => a - b);
const MIGRATION_COUNT = MIGRATION_VERSIONS.length;

const watchdog = setTimeout(() => {
  console.error("[dbMigration] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 10_000);

async function main() {
  const { openDb } = await import("../src/persistence/db");

  // ── Phase 1: Open a brand-new DB (triggers migration) ──────────────────
  console.log("[dbMigration] opening empty DB…");
  const db = openDb(".data_test_migration");

  // Verify schema_migrations has version 1.
  const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {
    version: number;
  }[];
  assert.strictEqual(versions.length, MIGRATION_COUNT, `all ${MIGRATION_COUNT} migrations applied`);
  assert.deepStrictEqual(
    versions.map((v) => v.version),
    MIGRATION_VERSIONS,
    "applied versions match the migration files on disk (contiguous, no gaps)",
  );
  console.log(`[dbMigration] ✔ all ${MIGRATION_COUNT} migrations applied`);

  // Verify all tables exist.
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence' ORDER BY name",
    )
    .all() as { name: string }[];
  const tableNames = tables.map((t) => t.name);

  const expected = [
    "accounts",
    "analytics_events",
    "characters",
    "feedback_reports",
    "friends",
    "guilds",
    "listings",
    "player_reports",
    "schema_migrations",
    "treasury",
  ];
  for (const t of expected) {
    assert.ok(tableNames.includes(t), `table '${t}' exists`);
  }
  console.log(`[dbMigration] ✔ all expected tables exist: ${expected.join(", ")}`);

  // Verify indexes exist on characters.
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='characters'")
    .all() as { name: string }[];
  const indexNames = indexes.map((i) => i.name);
  assert.ok(
    indexNames.some((n) => n.includes("account")),
    "account index exists",
  );
  assert.ok(
    indexNames.some((n) => n.includes("name")),
    "name unique index exists",
  );
  console.log("[dbMigration] ✔ character indexes exist");

  // Verify treasury single-row constraint.
  db.prepare("INSERT INTO treasury (id, total_burned, by_reason) VALUES (1, 0, '{}')").run();
  // Second insert should fail (CHECK constraint or UNIQUE).
  assert.throws(() => {
    db.prepare("INSERT INTO treasury (id, total_burned, by_reason) VALUES (1, 100, '{}')").run();
  }, "treasury single-row constraint enforced");
  console.log("[dbMigration] ✔ treasury single-row constraint works");

  db.close();

  // ── Phase 2: Re-open the same DB (idempotency) ─────────────────────────
  console.log("[dbMigration] re-opening same DB (idempotency check)…");
  const db2 = openDb(".data_test_migration");

  const versions2 = db2.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {
    version: number;
  }[];
  assert.strictEqual(
    versions2.length,
    MIGRATION_COUNT,
    `still only ${MIGRATION_COUNT} migrations (no duplication)`,
  );
  assert.deepStrictEqual(
    versions2.map((v) => v.version),
    MIGRATION_VERSIONS,
    "re-open preserves the exact migration set",
  );
  console.log("[dbMigration] ✔ re-open is idempotent");

  db2.close();

  // ── Cleanup ─────────────────────────────────────────────────────────────
  clearTimeout(watchdog);
  rmSync(".data_test_migration", { recursive: true, force: true });

  console.log("[dbMigration] PASS ✔  migration tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[dbMigration] FAIL ✘", err);
  clearTimeout(watchdog);
  rmSync(".data_test_migration", { recursive: true, force: true });
  process.exit(1);
});
