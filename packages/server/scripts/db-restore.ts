/**
 * db:restore — restore the SQLite database from a snapshot produced by db:backup.
 *
 * ⚠️  STOP THE SERVER FIRST. This replaces the live database file in place.
 *
 * The snapshot (`.db.gz` from db:backup, or a raw `.db`) is decompressed to a
 * temp file, integrity-checked, and only then atomically moved over the path in
 * DATABASE_URL. Stale WAL/SHM/journal sidecars are removed so the restored file
 * is the single source of truth on the next boot.
 *
 * Usage:
 *   pnpm --filter @maple/server run db:restore <snapshot.db.gz>
 *   BACKUP_FILE=<snapshot.db.gz> pnpm --filter @maple/server run db:restore
 *
 * Honours DATABASE_URL (default sqlite://./data/maple.db) for the restore target.
 */
import { createReadStream, createWriteStream, existsSync, renameSync, rmSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import Database from "better-sqlite3";
import { resolveDbPath } from "../src/persistence/db";

async function main(): Promise<void> {
  const arg = process.argv[2] ?? process.env.BACKUP_FILE;
  if (!arg) {
    console.error("[db:restore] usage: db:restore <snapshot.db.gz>  (or set BACKUP_FILE)");
    process.exit(1);
  }
  const snapshot = resolve(arg);
  if (!existsSync(snapshot)) {
    console.error(`[db:restore] snapshot not found: ${snapshot}`);
    process.exit(1);
  }

  const target = resolveDbPath();
  const tmp = `${target}.restore.tmp`;
  rmSync(tmp, { force: true });

  // 1) Materialise the snapshot to a temp file next to the target (same FS, so
  //    the later rename is atomic). Transparently handle gzip and raw .db.
  const decompress = snapshot.endsWith(".gz") ? createGunzip() : new PassThrough();
  await pipeline(createReadStream(snapshot), decompress, createWriteStream(tmp));

  // 2) Verify integrity BEFORE we touch the live database.
  const check = new Database(tmp, { readonly: true });
  const ok = check.pragma("integrity_check", { simple: true }) as string;
  check.close();
  if (ok !== "ok") {
    rmSync(tmp, { force: true });
    console.error(`[db:restore] snapshot is corrupt (integrity_check: ${ok}) — aborting`);
    process.exit(1);
  }

  // 3) Atomically swap in, clearing WAL/SHM/journal so the file stands alone.
  for (const sidecar of [`${target}-wal`, `${target}-shm`, `${target}-journal`]) {
    rmSync(sidecar, { force: true });
  }
  rmSync(target, { force: true });
  renameSync(tmp, target);

  console.log(`[db:restore] restored ${snapshot} → ${target}`);
  console.log("[db:restore] start the server to resume; migrations run automatically on boot.");
}

main().catch((err) => {
  console.error("[db:restore] FAIL", err);
  process.exit(1);
});
