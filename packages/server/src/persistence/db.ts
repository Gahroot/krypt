/**
 * Database layer — SQLite via better-sqlite3 with a lightweight migration system.
 *
 * Reads `DATABASE_URL` from the environment:
 *   - `sqlite://<path>` or unset → SQLite (default: `./data/maple.db`)
 *   - `postgresql://…` → clear error (driver not yet installed; Phase 2 prod path)
 *
 * On construction the Db class opens the database, enables WAL mode, and runs
 * any pending migrations from the `migrations/` directory.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// ─── Config ────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? "sqlite://./data/maple.db";

/**
 * Resolve a DATABASE_URL or path string to an absolute file path.
 * Creates the parent directory if it doesn't exist.
 */
export function resolveDbPath(url?: string): string {
  const raw = url ?? DATABASE_URL;
  if (raw.startsWith("postgresql://") || raw.startsWith("postgres://")) {
    throw new Error(
      "[db] Postgres driver not yet installed — use DATABASE_URL=sqlite://<path> for local dev.",
    );
  }
  const path = raw.startsWith("sqlite://") ? raw.slice("sqlite://".length) : raw;
  const abs = resolve(path);
  const dir = dirname(abs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return abs;
}

// ─── Migration runner ──────────────────────────────────────────────────────

/**
 * Run any pending SQL migrations against the given database.
 * Migrations live in `packages/server/src/persistence/migrations/*.sql`
 * and are numbered (e.g. `001_schema.sql`).
 */
export function ensureMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((r) => (r as { version: number }).version),
  );

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migDir = resolve(__dirname, "migrations");

  if (!existsSync(migDir)) return;

  const files = readdirSync(migDir).filter(
    (f) => f.endsWith(".sql") && !applied.has(parseVersion(f)),
  );
  files.sort((a, b) => parseVersion(a) - parseVersion(b));

  const insertVersion = db.prepare("INSERT INTO schema_migrations (version) VALUES (?)");

  const migrate = db.transaction(() => {
    for (const file of files) {
      const sql = readFileSync(resolve(migDir, file), "utf8");
      db.exec(sql);
      insertVersion.run(parseVersion(file));
      console.log(`[db] migration ${file} applied`);
    }
  });

  if (files.length > 0) migrate();
}

function parseVersion(filename: string): number {
  const m = filename.match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

// ─── Convenience opener ────────────────────────────────────────────────────

/** Open a database, enable WAL + FK, and run migrations. */
export function openDb(dbPath?: string): Database.Database {
  const path = dbPath ? resolveDbPath(dbPath) : resolveDbPath();
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureMigrations(db);
  return db;
}

export { Database };
