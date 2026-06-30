/**
 * Backup/restore test — proves the alpha persistence guarantee end-to-end:
 *
 *   1. Write known data to a SQLite DB.
 *   2. db:backup produces a consistent, integrity-checked gzip snapshot.
 *   3. Simulate disaster — delete the live DB and its WAL/SHM sidecars.
 *   4. db:restore brings the snapshot back into place.
 *   5. Re-open the restored DB and confirm the known data survived.
 *
 * Runs the real scripts (scripts/db-backup.ts, scripts/db-restore.ts) as child
 * processes, exactly as production cron does — so this verifies the scripts, not
 * a reimplementation.
 *
 * Run: npx tsx test/dbBackup.ts   (cwd = packages/server)
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDb } from "../src/persistence/db";

const ROOT = resolve(".data_test_backup");
const DB_PATH = join(ROOT, "maple.db");
const BACKUP_DIR = join(ROOT, "backups");
const DB_URL = `sqlite://${DB_PATH}`;

rmSync(ROOT, { recursive: true, force: true });

function run(script: string, args: string[] = []): string {
  return execFileSync("node", ["--import", "tsx", `scripts/${script}`, ...args], {
    env: { ...process.env, DATABASE_URL: DB_URL, BACKUP_DIR },
    encoding: "utf8",
  });
}

function newestSnapshot(): string {
  const snaps = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("maple-") && f.endsWith(".db.gz"))
    .sort();
  const last = snaps[snaps.length - 1];
  assert.ok(last, "a snapshot file was produced");
  return join(BACKUP_DIR, last);
}

function main(): void {
  // ── 1. Seed known data ────────────────────────────────────────────────
  const db = openDb(DB_URL);
  db.prepare("INSERT INTO accounts (account_id, cash) VALUES (?, ?)").run("acct-survivor", 12345);
  db.prepare(
    "INSERT INTO characters (char_id, account_id, name, archetype, appearance) VALUES (?,?,?,?,?)",
  ).run("char-1", "acct-survivor", "Aurora", "warrior", "{}");
  db.close();
  console.log("[dbBackup] ✔ seeded account + character");

  // ── 2. Backup ─────────────────────────────────────────────────────────
  run("db-backup.ts");
  const snapshot = newestSnapshot();
  console.log(`[dbBackup] ✔ snapshot written: ${snapshot}`);

  // ── 3. Simulate disaster — wipe the live DB and WAL/SHM sidecars ───────
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`, `${DB_PATH}-journal`]) {
    rmSync(f, { force: true });
  }
  // Drop a corrupt stub where the DB was, to prove restore truly replaces it.
  writeFileSync(DB_PATH, "not a database");
  assert.ok(existsSync(DB_PATH), "corrupt stub in place");
  console.log("[dbBackup] ✔ simulated data loss (DB wiped + corrupt stub)");

  // ── 4. Restore ────────────────────────────────────────────────────────
  run("db-restore.ts", [snapshot]);
  console.log("[dbBackup] ✔ restore completed");

  // ── 5. Verify the data survived ────────────────────────────────────────
  const restored = openDb(DB_URL);
  const acct = restored
    .prepare("SELECT cash FROM accounts WHERE account_id = ?")
    .get("acct-survivor") as { cash: number } | undefined;
  const char = restored.prepare("SELECT name FROM characters WHERE char_id = ?").get("char-1") as
    | { name: string }
    | undefined;
  restored.close();

  assert.ok(acct, "restored account exists");
  assert.strictEqual(acct.cash, 12345, "account cash preserved exactly");
  assert.ok(char, "restored character exists");
  assert.strictEqual(char.name, "Aurora", "character name preserved exactly");
  console.log("[dbBackup] ✔ all seeded data survived backup → wipe → restore");

  rmSync(ROOT, { recursive: true, force: true });
  console.log("[dbBackup] PASS ✔  backup/restore round-trip verified");
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error("[dbBackup] FAIL ✘", err);
  rmSync(ROOT, { recursive: true, force: true });
  process.exit(1);
}
