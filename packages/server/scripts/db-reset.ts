/**
 * db:reset — drop and recreate the SQLite database, then re-run all migrations.
 *
 * Deletes the database file (plus the WAL/SHM sidecars left by WAL mode) and
 * recreates it from scratch via `openDb`, which applies every migration in
 * `src/persistence/migrations/`. Use this for repeatable testing and to recover
 * from a local DB that has drifted into a bad/corrupt state.
 *
 * Honours `DATABASE_URL` (default `sqlite://./data/maple.db`), so it always
 * targets the same file the server boots against.
 *
 * Run: pnpm --filter @maple/server run db:reset
 */
import { existsSync, rmSync } from "node:fs";
import { openDb, resolveDbPath } from "../src/persistence/db";

function main(): void {
  const dbPath = resolveDbPath();

  // Remove the main file and the WAL/SHM sidecars created by WAL mode.
  const targets = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];
  let removed = 0;
  for (const f of targets) {
    if (existsSync(f)) {
      rmSync(f, { force: true });
      removed++;
    }
  }
  console.log(
    removed > 0
      ? `[db:reset] removed ${removed} existing file(s) at ${dbPath}`
      : `[db:reset] no existing database at ${dbPath} — creating fresh`,
  );

  // Recreate + migrate. openDb runs every pending migration on open.
  const db = openDb();
  const { version } = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };
  db.close();

  console.log(`[db:reset] fresh database ready at ${dbPath} (schema version ${version})`);
}

main();
