/**
 * db:backup — produce a consistent, compressed snapshot of the SQLite database.
 *
 * Uses SQLite's online backup API (better-sqlite3 `.backup()`), which captures a
 * single point-in-time snapshot even while the server is live and writing in WAL
 * mode — it does NOT block gameplay and never copies a half-written page. The
 * snapshot is integrity-checked, gzipped, and written to BACKUP_DIR; snapshots
 * beyond BACKUP_RETENTION are pruned (oldest first).
 *
 * Env:
 *   DATABASE_URL      source DB        (default sqlite://./data/maple.db)
 *   BACKUP_DIR        output directory (default <db-dir>/backups)
 *   BACKUP_RETENTION  snapshots to keep (default 14)
 *
 * Run:   pnpm --filter @maple/server run db:backup
 * Output: the absolute path of the snapshot it wrote is printed as the LAST line
 *         (stdout), so a wrapper can capture it for off-box upload.
 */
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { resolveDbPath } from "../src/persistence/db";

const PREFIX = "maple-";

/** ISO-8601 timestamp made filename-safe (colons/dots → dashes). Sorts chronologically. */
function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<void> {
  const src = resolveDbPath();
  if (!existsSync(src)) {
    console.error(`[db:backup] no database at ${src} — nothing to back up`);
    process.exit(1);
  }

  const backupDir = process.env.BACKUP_DIR
    ? resolve(process.env.BACKUP_DIR)
    : join(dirname(src), "backups");
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

  const retention = Math.max(1, Number(process.env.BACKUP_RETENTION ?? 14) || 14);

  const stamp = timestamp();
  const tmpSnap = join(backupDir, `.${PREFIX}${stamp}.db.tmp`);
  const finalGz = join(backupDir, `${PREFIX}${stamp}.db.gz`);

  // 1) Consistent online snapshot via SQLite's backup API.
  const db = new Database(src);
  try {
    await db.backup(tmpSnap);
    // Trust nothing — verify the snapshot before we keep it.
    const snap = new Database(tmpSnap, { readonly: true });
    const ok = snap.pragma("integrity_check", { simple: true }) as string;
    snap.close();
    if (ok !== "ok") throw new Error(`snapshot failed integrity_check: ${ok}`);
  } finally {
    db.close();
  }

  // 2) Compress, then drop the uncompressed temp.
  await pipeline(createReadStream(tmpSnap), createGzip({ level: 9 }), createWriteStream(finalGz));
  rmSync(tmpSnap, { force: true });

  const size = statSync(finalGz).size;
  console.log(`[db:backup] wrote ${finalGz} (${(size / 1024).toFixed(1)} KiB)`);

  // 3) Prune snapshots older than the retention window (ISO names sort by time).
  const snaps = readdirSync(backupDir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".db.gz"))
    .sort();
  for (const f of snaps.slice(0, Math.max(0, snaps.length - retention))) {
    rmSync(join(backupDir, f), { force: true });
    console.log(`[db:backup] pruned old snapshot ${f}`);
  }

  // LAST line: the snapshot path, for off-box upload scripting.
  console.log(finalGz);
}

main().catch((err) => {
  console.error("[db:backup] FAIL", err);
  process.exit(1);
});
